package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var missavStreamSlots = make(chan struct{}, 8)

type missavPipeBody struct {
	io.Reader
	pipe   io.ReadCloser
	cmd    *exec.Cmd
	cancel context.CancelFunc
	once   sync.Once
}

func (body *missavPipeBody) Close() error {
	body.once.Do(func() { body.cancel(); body.pipe.Close(); body.cmd.Wait(); <-missavStreamSlots })
	return nil
}

// Some CDN edges reject Go's TLS handshake. Stream curl_cffi's response through
// a bounded process pipe rather than buffering a video or invoking the downloader.
func missavCurlResponse(r *http.Request, target *url.URL) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	select {
	case missavStreamSlots <- struct{}{}:
	case <-ctx.Done():
		cancel()
		return nil, ctx.Err()
	}
	cmd := exec.CommandContext(ctx, resolvePythonExecutable(), filepath.Join(scriptsDir, "missav_resolver.py"), "--stream", target.String(), r.Method, r.Header.Get("Range"))
	configurePythonProcess(cmd)
	cmd.WaitDelay = 3 * time.Second
	cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8")
	cmd.Stderr = &boundedOutput{limit: 4096}
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		<-missavStreamSlots
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		pipe.Close()
		cancel()
		<-missavStreamSlots
		return nil, err
	}
	reader := bufio.NewReaderSize(pipe, 65536)
	body := &missavPipeBody{Reader: reader, pipe: pipe, cmd: cmd, cancel: cancel}
	line, err := reader.ReadSlice('\n')
	var metadata struct {
		Status  int               `json:"status"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
	}
	if err != nil || json.Unmarshal(line, &metadata) != nil || metadata.Status < 100 || metadata.Status > 599 {
		body.Close()
		return nil, fmt.Errorf("media compatibility request failed")
	}
	final, err := url.Parse(metadata.URL)
	if err != nil || !missavMediaAllowed(final) {
		body.Close()
		return nil, fmt.Errorf("invalid media redirect")
	}
	header := make(http.Header)
	for key, value := range metadata.Headers {
		header.Set(key, value)
	}
	return &http.Response{StatusCode: metadata.Status, Header: header, Body: body, Request: &http.Request{URL: final}}, nil
}

var missavClientOnce sync.Once
var missavClient *http.Client

func missavHTTPClient() *http.Client {
	missavClientOnce.Do(func() {
		client := *outboundClient()
		// Match the resolver: environment wins, then the existing downloader proxy config.
		if proxyURL == "" {
			data, err := os.ReadFile(filepath.Join(scriptsDir, "cfg", "configs.json"))
			var config struct {
				Proxy string `json:"Proxy"`
			}
			if err == nil && json.Unmarshal(data, &config) == nil && config.Proxy != "" {
				if proxy, err := url.Parse(config.Proxy); err == nil && proxy.Host != "" {
					client.Transport = &http.Transport{Proxy: http.ProxyURL(proxy)}
				}
			}
		}
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || !missavMediaAllowed(req.URL) {
				return fmt.Errorf("unsupported media redirect")
			}
			return nil
		}
		missavClient = &client
	})
	return missavClient
}

var missavListCategories = map[string]struct{}{
	"new": {}, "release": {}, "chinese-subtitle": {}, "uncensored-leak": {},
	"english-subtitle": {}, "fc2": {}, "madou": {}, "heyzo": {},
}
var missavListSorts = map[string]struct{}{"latest": {}, "hot": {}, "rating": {}}

type missavListCacheEntry struct {
	body []byte
	at   time.Time
}

var missavListCache = struct {
	sync.Mutex
	items map[string]missavListCacheEntry
}{items: map[string]missavListCacheEntry{}}

func missavListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	category := r.URL.Query().Get("category")
	if category == "" {
		category = "new"
	}
	sort := r.URL.Query().Get("sort")
	if sort == "" {
		sort = "latest"
	}
	page := 1
	if raw := r.URL.Query().Get("page"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 2000 {
			httpError(w, "页码超出范围", http.StatusBadRequest)
			return
		}
		page = parsed
	}
	if _, ok := missavListCategories[category]; !ok {
		httpError(w, "不支持的 MissAV 分类", http.StatusBadRequest)
		return
	}
	if _, ok := missavListSorts[sort]; !ok {
		httpError(w, "不支持的 MissAV 排序", http.StatusBadRequest)
		return
	}
	cacheKey := category + "|" + strconv.Itoa(page) + "|" + sort
	missavListCache.Lock()
	if cached, ok := missavListCache.items[cacheKey]; ok && time.Since(cached.at) < 2*time.Minute {
		body := cached.body
		missavListCache.Unlock()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(body)
		return
	}
	missavListCache.Unlock()

	stdout, stderr, err := runPythonContext(r.Context(), 70*time.Second, "missav_resolver.py", []string{"--list", category, strconv.Itoa(page), sort}, nil)
	line, _ := parsePythonJSON(stdout, stderr)
	var probe struct {
		Success bool `json:"success"`
	}
	if json.Unmarshal([]byte(line), &probe) != nil || (err != nil && probe.Success) {
		line = `{"success":false,"code":"RESOLVER_UNAVAILABLE","error":"MissAV 列表未完成，请检查 Python 环境、网络或稍后重试"}`
		probe.Success = false
	}
	body := []byte(line)
	if probe.Success {
		missavListCache.Lock()
		if len(missavListCache.items) > 40 {
			missavListCache.items = map[string]missavListCacheEntry{}
		}
		missavListCache.items[cacheKey] = missavListCacheEntry{body: body, at: time.Now()}
		missavListCache.Unlock()
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(body)
}

var missavCoverCode = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var missavCoverClientOnce sync.Once
var missavCoverClient *http.Client

func missavCoverHTTPClient() *http.Client {
	missavCoverClientOnce.Do(func() {
		client := *outboundClient()
		if proxyURL == "" {
			data, err := os.ReadFile(filepath.Join(scriptsDir, "cfg", "configs.json"))
			var config struct {
				Proxy string `json:"Proxy"`
			}
			if err == nil && json.Unmarshal(data, &config) == nil && config.Proxy != "" {
				if proxy, err := url.Parse(config.Proxy); err == nil && proxy.Host != "" {
					client.Transport = &http.Transport{Proxy: http.ProxyURL(proxy)}
				}
			}
		}
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.Hostname() != "fourhoi.com" || req.URL.User != nil {
				return fmt.Errorf("unsupported cover redirect")
			}
			return nil
		}
		missavCoverClient = &client
	})
	return missavCoverClient
}

type missavCoverCacheEntry struct {
	body        []byte
	contentType string
	at          time.Time
}

var missavCoverCache = struct {
	sync.Mutex
	items map[string]missavCoverCacheEntry
}{items: map[string]missavCoverCacheEntry{}}

func missavCurlCover(ctx context.Context, code string) ([]byte, string, error) {
	stdout, stderr, err := runPythonContext(ctx, 25*time.Second, "missav_resolver.py", []string{"--cover", code}, nil)
	line, _ := parsePythonJSON(stdout, stderr)
	var result struct {
		Success bool   `json:"success"`
		Type    string `json:"type"`
		Data    string `json:"data"`
	}
	if json.Unmarshal([]byte(line), &result) != nil || !result.Success {
		if err != nil {
			return nil, "", err
		}
		return nil, "", fmt.Errorf("cover compatibility request failed")
	}
	if !strings.HasPrefix(result.Type, "image/") {
		return nil, "", fmt.Errorf("unsupported cover type")
	}
	body, err := base64.StdEncoding.DecodeString(result.Data)
	if err != nil || len(body) == 0 || len(body) > 2<<20 {
		return nil, "", fmt.Errorf("invalid cover payload")
	}
	return body, result.Type, nil
}

func missavCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	code := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("code")))
	if _, blocked := missavListCategories[code]; blocked || len(code) < 2 || len(code) > 80 || !missavCoverCode.MatchString(code) {
		httpError(w, "不支持的封面编号", http.StatusBadRequest)
		return
	}
	missavCoverCache.Lock()
	if cached, ok := missavCoverCache.items[code]; ok && time.Since(cached.at) < 30*time.Minute {
		body, contentType := cached.body, cached.contentType
		missavCoverCache.Unlock()
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "private, max-age=3600")
		if r.Method != http.MethodHead {
			w.Write(body)
		}
		return
	}
	missavCoverCache.Unlock()

	var body []byte
	contentType := ""
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://fourhoi.com/"+code+"/cover-t.jpg", nil)
	if err == nil {
		request.Header.Set("Referer", "https://missav.ai/")
		request.Header.Set("User-Agent", "Mozilla/5.0")
		request.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
		response, reqErr := missavCoverHTTPClient().Do(request)
		if reqErr == nil {
			defer response.Body.Close()
			if response.StatusCode == http.StatusOK && strings.HasPrefix(response.Header.Get("Content-Type"), "image/") {
				read, readErr := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
				if readErr == nil && len(read) > 0 && len(read) <= 2<<20 {
					body = read
					contentType = response.Header.Get("Content-Type")
				}
			}
		}
	}
	if body == nil {
		fetched, fetchedType, fetchErr := missavCurlCover(r.Context(), code)
		if fetchErr != nil {
			httpError(w, "封面请求失败", http.StatusBadGateway)
			return
		}
		body, contentType = fetched, fetchedType
	}
	missavCoverCache.Lock()
	if len(missavCoverCache.items) > 200 {
		missavCoverCache.items = map[string]missavCoverCacheEntry{}
	}
	missavCoverCache.items[code] = missavCoverCacheEntry{body: body, contentType: contentType, at: time.Now()}
	missavCoverCache.Unlock()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}

func missavResolveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var input struct {
		Input string `json:"input"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil || strings.TrimSpace(input.Input) == "" {
		httpError(w, "请输入 MissAV 链接或番号", http.StatusBadRequest)
		return
	}
	stdout, stderr, err := runPythonContext(r.Context(), 80*time.Second, "missav_resolver.py", []string{input.Input}, nil)
	line, _ := parsePythonJSON(stdout, stderr)
	var result struct {
		Success bool   `json:"success"`
		URL     string `json:"url"`
		Title   string `json:"title"`
		Code    string `json:"code"`
		Error   string `json:"error"`
	}
	if json.Unmarshal([]byte(line), &result) != nil || (err != nil && result.Success) {
		result.Success = false
		result.Code = "RESOLVER_UNAVAILABLE"
		result.Error = "MissAV 解析未完成，请检查 Python 环境、网络或稍后重试"
	}
	if result.Success {
		target, parseErr := url.Parse(result.URL)
		if parseErr != nil || !missavMediaAllowed(target) {
			result.Success = false
			result.Code = "INVALID_STREAM"
			result.Error = "解析返回了不支持的视频地址"
		} else {
			result.URL = missavProxyURL(target, r.URL.Query().Get("key"))
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(result)
}

// This proxy is restricted to MissAV's media CDN; it is not an arbitrary URL proxy.
func missavMediaAllowed(u *url.URL) bool {
	return u != nil && u.Scheme == "https" && u.Hostname() == "surrit.com" && (u.Port() == "" || u.Port() == "443") && u.User == nil
}

func missavProxyURL(target *url.URL, key string) string {
	query := url.Values{"url": {target.String()}}
	if key != "" {
		query.Set("key", key)
	}
	return "/api/missav/stream/" + url.PathEscape(path.Base(target.Path)) + "?" + query.Encode()
}

var hlsURI = regexp.MustCompile(`URI="([^"]+)"`)

func rewriteMissavPlaylist(data []byte, base *url.URL, key string) ([]byte, error) {
	if !strings.HasPrefix(strings.TrimSpace(string(data)), "#EXTM3U") {
		return nil, fmt.Errorf("invalid HLS playlist")
	}
	rewrite := func(raw string) (string, error) {
		ref, err := url.Parse(raw)
		if err != nil {
			return "", err
		}
		target := base.ResolveReference(ref)
		if !missavMediaAllowed(target) {
			return "", fmt.Errorf("unsupported HLS resource host")
		}
		// Relative URLs keep the /backend-api prefix in the web version as well.
		return "./" + strings.TrimPrefix(missavProxyURL(target, key), "/api/missav/stream/"), nil
	}
	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "#") {
			next, err := rewrite(line)
			if err != nil {
				return nil, err
			}
			lines[i] = next
		} else {
			var replaceErr error
			lines[i] = hlsURI.ReplaceAllStringFunc(line, func(attr string) string {
				next, err := rewrite(hlsURI.FindStringSubmatch(attr)[1])
				if err != nil {
					replaceErr = err
					return attr
				}
				return `URI="` + next + `"`
			})
			if replaceErr != nil {
				return nil, replaceErr
			}
		}
	}
	return []byte(strings.Join(lines, "\n")), nil
}

func missavStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target, err := url.Parse(r.URL.Query().Get("url"))
	if err != nil || !missavMediaAllowed(target) {
		httpError(w, "Unsupported media URL", http.StatusBadRequest)
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), nil)
	if err != nil {
		httpError(w, "Invalid media URL", http.StatusBadRequest)
		return
	}
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.Header.Set("Referer", "https://missav.ai/")
	request.Header.Set("Accept-Encoding", "identity")
	playlist := strings.HasSuffix(strings.ToLower(target.Path), ".m3u8")
	if !playlist {
		for _, name := range []string{"Range", "If-Range"} {
			if value := r.Header.Get(name); value != "" {
				request.Header.Set(name, value)
			}
		}
	}
	response, err := missavHTTPClient().Do(request)
	if err != nil || response.StatusCode == http.StatusForbidden {
		if response != nil {
			response.Body.Close()
		}
		response, err = missavCurlResponse(request, target)
	}
	if err != nil {
		httpError(w, "视频分片请求失败，请检查后端网络或代理", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		if response.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			w.Header().Set("Content-Range", response.Header.Get("Content-Range"))
			w.WriteHeader(response.StatusCode)
			return
		}
		httpError(w, fmt.Sprintf("视频源返回 HTTP %d，请重新解析或检查网络", response.StatusCode), http.StatusBadGateway)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if playlist && r.Method != http.MethodHead {
		data, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
		if err != nil || len(data) > 2<<20 {
			httpError(w, "Invalid HLS playlist size", http.StatusBadGateway)
			return
		}
		data, err = rewriteMissavPlaylist(data, response.Request.URL, r.URL.Query().Get("key"))
		if err != nil {
			httpError(w, "视频清单无效或包含不支持的分片地址", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Write(data)
		return
	}
	for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := response.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	if r.Method != http.MethodHead {
		io.Copy(w, response.Body)
	}
}
