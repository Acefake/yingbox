package main

import (
	"bufio"
	"context"
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
