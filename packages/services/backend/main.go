package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"embed"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "modernc.org/sqlite"
)

// 服务器端口
const serverPort = ":31471"

// 安全相关配置，均可用环境变量覆盖：
//   - BIND_ADDR                     监听地址，默认仅本机回环，避免影库/下载能力暴露到局域网
//   - YINGBOX_API_KEY               非本机请求所需密钥（Authorization: Bearer 或 ?key=）；为空则不校验
//   - YINGBOX_PROXY_URL             出站代理（抓取/图片代理走它）；为空则直连
//   - YINGBOX_ALLOWED_ORIGINS       CORS 白名单，逗号分隔，* 表示全部
//   - YINGBOX_ALLOW_PRIVATE_PROXY   置 1 时允许 /proxy 访问内网地址（默认拒绝，防 SSRF）
//   - YINGBOX_ALLOW_INSECURE_LAN    置 1 时允许无密钥监听非回环地址（默认拒绝并直接退出）
var (
	envApiKey        = strings.TrimSpace(os.Getenv("YINGBOX_API_KEY"))
	proxyURL         = strings.TrimSpace(os.Getenv("YINGBOX_PROXY_URL"))
	listenAddr       = envOr("BIND_ADDR", "127.0.0.1"+serverPort)
	allowedOrigins   = splitList(os.Getenv("YINGBOX_ALLOWED_ORIGINS"))
	allowPrivateSSRF = os.Getenv("YINGBOX_ALLOW_PRIVATE_PROXY") == "1"
)

// envOr 读取环境变量，为空时返回默认值
func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// splitList 解析逗号分隔的配置项
func splitList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// 动态获取视频库路径（优先环境变量，其次系统视频目录，最后临时目录）
func getBasePath() string {
	if configPath := os.Getenv("YINGBOX_CONFIG_PATH"); configPath != "" {
		if data, err := os.ReadFile(configPath); err == nil {
			var config struct {
				DownloadPath string `json:"downloadPath"`
			}
			if json.Unmarshal(data, &config) == nil && filepath.IsAbs(config.DownloadPath) {
				return config.DownloadPath
			}
		}
	}
	if p := os.Getenv("MISSAV_VIDEO_PATH"); p != "" {
		return p
	}
	// 尝试使用用户视频目录
	home, _ := os.UserHomeDir()
	if home != "" {
		videos := filepath.Join(home, "Videos")
		if _, err := os.Stat(videos); err == nil {
			return videos
		}
	}
	// 回退到临时目录
	return os.TempDir()
}

// 嵌入所有 Python 脚本 — 打包成一个二进制
//
//go:embed py/tools/fetch_meta.py
//go:embed py/main.py
//go:embed py/metadata.py
//go:embed py/requirements.txt
//go:embed py/src/__init__.py
//go:embed py/src/comm.py
//go:embed py/src/task_lock.py
//go:embed py/src/data.py
//go:embed py/src/scraper.py
//go:embed py/src/downloaderMgr.py
//go:embed py/src/downloader/*.py
//go:embed py/cfg/configs.json
//go:embed py/vod_parser.py
//go:embed py/catspider_runner.js
//go:embed py/vod.json

//go:generate powershell -NoProfile -Command "Copy-Item -Recurse -Force ../main.py py/; Copy-Item -Recurse -Force ../metadata.py py/; Copy-Item -Recurse -Force ../requirements.txt py/; Copy-Item -Recurse -Force ../tools py/; Copy-Item -Recurse -Force ../src py/; Copy-Item -Recurse -Force ../cfg py/; if (!(Test-Path py/db)) { New-Item -ItemType Directory -Path py/db }"
var pyScripts embed.FS

// 提取后 Python 脚本所在的根目录
var scriptsDir string

// 全局缓存
var (
	videoListCache []VideoItem
	cacheMutex     sync.RWMutex
	logger         = log.New(os.Stdout, "[MissAV] ", log.LstdFlags|log.Lshortfile)
)

// ── 性能：列表构建指纹（数量 + 目录总数 + 最大 mtime），避免无变化时重复解析 NFO ──
var cacheFingerprint string

// ── 性能：视频详情缓存（按目录 mtime 校验），命中时跳过 ReadDir + NFO 解析 ──
type detailCacheEntry struct {
	dirMtime time.Time
	detail   VideoDetail
}

var detailCache = struct {
	sync.RWMutex
	m map[string]detailCacheEntry
}{m: make(map[string]detailCacheEntry)}

// ── 性能：JavBus 元数据缓存（TTL）+ 单飞（并发同 avid 只 spawn 一次 Python）──
type metaCacheEntry struct {
	expires time.Time
	body    []byte
}

type metaFlight struct {
	wg   sync.WaitGroup
	body []byte
}

var (
	metaCache   sync.Map // avid -> metaCacheEntry
	metaFlights sync.Map // avid -> *metaFlight
)

const metaCacheTTL = 15 * time.Minute

// ── 性能：出站 HTTP 客户端复用（代理地址启动后不变，避免每次请求解析代理 URL + 新建 Transport）──
var (
	outboundDirectClient *http.Client
	outboundProxyClient  *http.Client
	outboundOnce         sync.Once
)

func outboundClients() (*http.Client, *http.Client) {
	outboundOnce.Do(func() {
		direct := &http.Transport{}
		outboundDirectClient = &http.Client{
			Transport: direct,
			Timeout:   30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				if !allowPrivateSSRF && isPrivateHost(req.URL.Host) {
					return fmt.Errorf("redirect target not allowed")
				}
				return nil
			},
		}
		if proxyURL != "" {
			proxyAddr, err := url.Parse(proxyURL)
			if err != nil {
				logger.Printf("Invalid YINGBOX_PROXY_URL %q, outbound via direct: %v", proxyURL, err)
				return
			}
			outboundProxyClient = &http.Client{
				Transport: &http.Transport{Proxy: http.ProxyURL(proxyAddr)},
				Timeout:   30 * time.Second,
				CheckRedirect: func(req *http.Request, via []*http.Request) error {
					if len(via) >= 5 {
						return fmt.Errorf("too many redirects")
					}
					if !allowPrivateSSRF && isPrivateHost(req.URL.Host) {
						return fmt.Errorf("redirect target not allowed")
					}
					return nil
				},
			}
		}
	})
	return outboundDirectClient, outboundProxyClient
}

// outboundClient 按配置返回代理或直连客户端（代理不可用时调用方自行回退由各自逻辑决定）
func outboundClient() *http.Client {
	direct, proxied := outboundClients()
	if proxied != nil {
		return proxied
	}
	return direct
}

// ── 性能：downloaded.db 全局句柄（WAL + busy_timeout），避免每次请求 open + 建表 ──
var (
	downloadedDB   *sql.DB
	downloadedDBMu sync.Mutex
)

func getDownloadedDB() (*sql.DB, error) {
	downloadedDBMu.Lock()
	defer downloadedDBMu.Unlock()
	if downloadedDB != nil {
		return downloadedDB, nil
	}
	dbDir := filepath.Join(scriptsDir, "db")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dbDir, "downloaded.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	// WAL 提升并发读性能；busy_timeout 避免高并发写时直接报 locked
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		db.Close()
		return nil, err
	}
	if err := initDB(db); err != nil {
		db.Close()
		return nil, err
	}
	downloadedDB = db
	return downloadedDB, nil
}

// VideoItem 表示视频列表项
type VideoItem struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Poster string `json:"poster"`
}

// VideoDetail 视频详细信息
type VideoDetail struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	ReleaseDate string   `json:"releaseDate"`
	Fanarts     []string `json:"fanarts"`
	VideoFile   string   `json:"videoFile,omitempty"`
}

// NfoFile NFO文件结构
type NfoFile struct {
	XMLName     xml.Name `xml:"movie"`
	Title       string   `xml:"title"`
	ReleaseDate string   `xml:"releasedate"`
	Premiered   string   `xml:"premiered"`
}

// extractScripts 将嵌入的 Python 脚本提取到 scriptsDir
func extractScripts(dst string) error {
	logger.Printf("Extracting Python scripts to %s", dst)
	return fsExtract(pyScripts, "py", dst, true)
}

// fsExtract 递归提取 embed.FS 中 prefix 下的所有文件到 dst
// stripPrefix 为 true 时去掉 prefix 前缀
func fsExtract(fs embed.FS, prefix, dst string, stripPrefix bool) error {
	entries, err := fs.ReadDir(prefix)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := prefix + "/" + entry.Name()
		rel := srcPath
		if stripPrefix {
			rel = strings.TrimPrefix(srcPath, "py/")
		}
		dstPath := filepath.Join(dst, filepath.FromSlash(rel))

		if entry.IsDir() {
			if err := os.MkdirAll(dstPath, 0755); err != nil {
				return err
			}
			if err := fsExtract(fs, srcPath, dst, stripPrefix); err != nil {
				return err
			}
		} else {
			data, err := fs.ReadFile(srcPath)
			if err != nil {
				return err
			}
			// 跳过 cfg/configs.json 和 db/*（保留用户已有配置和数据）
			skip := strings.HasPrefix(rel, "cfg/") || strings.HasPrefix(rel, "db/")
			if skip {
				if _, err := os.Stat(dstPath); err == nil {
					continue
				}
			}
			if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
				return err
			}
			if err := os.WriteFile(dstPath, data, 0644); err != nil {
				return err
			}
			logger.Printf("  extracted: %s", rel)
		}
	}
	return nil
}

// runPython 封装执行 Python 脚本，返回 stdout

func parsePythonJSON(stdout, stderr string) (string, string) {
	lines := strings.Split(strings.TrimSpace(stdout), "\n")
	jsonLine := ""
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "{") {
			jsonLine = line
			break
		}
	}
	return jsonLine, stderr
}

// isLoopbackHost 判断 Host 头是否为本机地址。
// 防 DNS rebinding：远端域名解析到 127.0.0.1 时 Host 仍是攻击者域名，必须拒绝。
func isLoopbackHost(host string) bool {
	if host == "" {
		return false
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// requestHasValidKey 校验 Authorization: Bearer <key> 或 ?key=<key>
// constant-time 比较，避免时序侧信道。
func requestHasValidKey(r *http.Request) bool {
	if envApiKey == "" {
		return false
	}
	token := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	} else {
		token = r.URL.Query().Get("key")
	}
	if token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(envApiKey)) == 1
}

// remoteIsLoopback 判断连接来源是否为本机
func remoteIsLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// originAllowed 判断请求 Origin 是否在允许列表内（空列表 = 仅本机来源）
func originAllowed(origin string) bool {
	for _, o := range allowedOrigins {
		if o == "*" || strings.EqualFold(o, origin) {
			return true
		}
	}
	if origin == "" {
		return true // 非浏览器请求（curl / Electron 同源）无 Origin
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return isLoopbackHost(u.Host)
}

// securityGuard 统一处理 CORS 白名单、DNS rebinding 防护与接口鉴权。
//
// 规则：
//  1. Host 必须是本机地址，或请求携带有效密钥 —— 阻断 DNS rebinding 与网页 CSRF。
//  2. 配置了 YINGBOX_API_KEY 时，非本机来源必须带密钥（供 NAS/局域网/手机使用）。
//  3. CORS 只对白名单（默认本机）来源回包，其余不返回 CORS 头。
func securityGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hasKey := requestHasValidKey(r)
		local := remoteIsLoopback(r) && isLoopbackHost(r.Host)

		// 1) DNS rebinding / CSRF：外部 Host 且无有效密钥直接拒绝
		if !isLoopbackHost(r.Host) && !hasKey {
			http.Error(w, "Forbidden: non-local Host requires a valid API key", http.StatusForbidden)
			return
		}

		// 2) 鉴权：配了密钥后，非本机来源必须带密钥
		if envApiKey != "" && !local && !hasKey {
			http.Error(w, "Unauthorized: missing or invalid API key", http.StatusUnauthorized)
			return
		}

		// 3) CORS：仅对白名单来源回包
		origin := r.Header.Get("Origin")
		if origin != "" && originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	logger.Println("Starting MissAV server...")

	// 1. 确定 Python 脚本目录
	scriptsDir = os.Getenv("PY_SCRIPTS_DIR")
	if scriptsDir == "" {
		exe, err := os.Executable()
		if err == nil {
			scriptsDir = filepath.Join(filepath.Dir(exe), "py")
		} else {
			scriptsDir = filepath.Join(".", "py")
		}
	}
	logger.Printf("Python scripts dir: %s", scriptsDir)

	// 2. 提取嵌入的 Python 脚本（尝试主目录，失败则回退到用户目录）
	if err := extractScripts(scriptsDir); err != nil {
		logger.Printf("Warning: failed to extract to %s: %v", scriptsDir, err)
		// 回退到用户 AppData 目录
		if home, herr := os.UserHomeDir(); herr == nil {
			fallbackDir := filepath.Join(home, ".yingbox", "py")
			if ferr := os.MkdirAll(fallbackDir, 0755); ferr == nil {
				if err := extractScripts(fallbackDir); err != nil {
					logger.Fatalf("Failed to extract Python scripts to fallback: %v", err)
				}
				scriptsDir = fallbackDir
				logger.Printf("Using fallback scripts dir: %s", scriptsDir)
			} else {
				logger.Fatalf("Failed to create fallback directory: %v", ferr)
			}
		} else {
			logger.Fatalf("Failed to get home directory: %v", herr)
		}
	}

	// 3. 初始化缓存（失败时继续启动，使用空缓存）
	if err := buildVideoListCache(); err != nil {
		logger.Printf("Initial cache build warning: %v", err)
	}

	startDownloadWorker()

	// 4. 启动定时缓存更新
	go startCacheUpdater(30 * time.Minute)

	// 5. 设置路由
	mux := http.NewServeMux()
	mux.HandleFunc("/api/videos", listVideosHandler)
	mux.HandleFunc("/api/videos/", videoDetailHandler)
	mux.HandleFunc("/api/addvideo/", addVideoHandler)
	mux.HandleFunc("/api/queue", queueHandler)
	mux.HandleFunc("/api/download-status", downloadStatusHandler)
	mux.HandleFunc("/api/meta/", metaHandler)
	mux.HandleFunc("/api/scrape/", scrapeHandler)
	mux.HandleFunc("/api/vod/sites", vodSitesHandler)
	mux.HandleFunc("/api/vod/parse", vodParseHandler)
	mux.HandleFunc("/proxy", proxyImageHandler)
	mux.HandleFunc("/file/", imageHandler)

	handler := securityGuard(mux)

	// 6. 优雅关闭：收到 SIGINT/SIGTERM 时干净释放端口
	server := &http.Server{Addr: listenAddr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-quit
		stopWorkers()
		logger.Printf("Received signal %v, shutting down...", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Printf("Shutdown error: %v", err)
		}
	}()

	logger.Printf("Server listening on %s (api key required for non-local: %t)", listenAddr, envApiKey != "")
	if proxyURL != "" {
		logger.Printf("Outbound proxy enabled: %s", proxyURL)
	}
	if !isLoopbackHost(listenAddr) {
		if envApiKey == "" && os.Getenv("YINGBOX_ALLOW_INSECURE_LAN") != "1" {
			logger.Fatalf("Refusing to listen on non-loopback %s without YINGBOX_API_KEY: "+
				"video library and download queue would be exposed to the LAN unauthenticated. "+
				"Set YINGBOX_API_KEY to allow remote access, or YINGBOX_ALLOW_INSECURE_LAN=1 to override (not recommended).", listenAddr)
		}
		logger.Printf("WARNING: bound to %s; remote access requires a valid YINGBOX_API_KEY.", listenAddr)
	}
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		logger.Fatalf("Server error: %v", err)
	}
	logger.Println("Server stopped")
}

// startCacheUpdater 定时更新缓存
func startCacheUpdater(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-workerContext.Done():
			return
		case <-ticker.C:
		logger.Println("Starting scheduled cache update...")
		if err := buildVideoListCache(); err != nil {
			logger.Printf("Cache update failed: %v", err)
		} else {
			logger.Println("Cache updated successfully")
		}
		}
	}
}

// buildVideoListCache 构建视频列表缓存（poster 存在性检查与 NFO 解析并发执行）
func buildVideoListCache() error {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	startTime := time.Now()
	logger.Println("Building video list cache...")

	basePath := getBasePath()
	files, err := os.ReadDir(basePath)
	if err != nil {
		logger.Printf("Warning: reading directory %s failed: %v. Using empty cache.", basePath, err)
		videoListCache = []VideoItem{}
		return nil
	}

	type dirEntryWithInfo struct {
		entry os.DirEntry
		info  os.FileInfo
	}

	var dirs []dirEntryWithInfo
	var maxMtime int64
	for _, file := range files {
		if !file.IsDir() {
			continue
		}
		info, err := file.Info()
		if err != nil {
			logger.Printf("Error getting info for %s: %v", file.Name(), err)
			continue
		}
		if mt := info.ModTime().UnixNano(); mt > maxMtime {
			maxMtime = mt
		}
		dirs = append(dirs, dirEntryWithInfo{entry: file, info: info})
	}

	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].info.ModTime().After(dirs[j].info.ModTime())
	})

	fingerprint := fmt.Sprintf("%d/%d/%d", len(dirs), len(videoListCache), maxMtime)
	if fingerprint == cacheFingerprint && videoListCache != nil {
		logger.Printf("Cache unchanged (fingerprint %s)", fingerprint)
		return nil
	}

	// 并发检查 poster + 解析标题：syscall 密集，worker 数取 CPU 2 倍
	workers := 2 * runtime.NumCPU()
	if workers < 8 {
		workers = 8
	}
	if workers > 64 {
		workers = 64
	}
	type slot struct {
		item  VideoItem
		valid bool
	}
	results := make([]slot, len(dirs))
	sem := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for i, dir := range dirs {
		wg.Add(1)
		go func(i int, dir dirEntryWithInfo) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			videoID := dir.entry.Name()
			posterPath := filepath.Join(basePath, videoID, videoID+"-poster.jpg")
			if _, err := os.Stat(posterPath); err != nil {
				return
			}
			title, _, err := parseTitleAndDate(videoID)
			if err != nil {
				title = videoID
			}
			results[i] = slot{valid: true, item: VideoItem{
				ID:     videoID,
				Title:  title,
				Poster: fmt.Sprintf("/file/%s/%s-poster.jpg", videoID, videoID),
			}}
		}(i, dir)
	}
	wg.Wait()

	videoListCache = videoListCache[:0]
	count := 0
	for _, r := range results {
		if !r.valid {
			continue
		}
		videoListCache = append(videoListCache, r.item)
		count++
	}
	cacheFingerprint = fmt.Sprintf("%d/%d/%d", len(dirs), count, maxMtime)

	logger.Printf("Cache built successfully. Items: %d, Duration: %v", count, time.Since(startTime))
	return nil
}

// parseTitleAndDate 解析NFO文件获取标题和日期
func parseTitleAndDate(videoID string) (title, releaseDate string, err error) {
	nfoPath := filepath.Join(getBasePath(), videoID, videoID+".nfo")

	file, err := os.Open(nfoPath)
	if err != nil {
		return "", "", fmt.Errorf("open file failed: %w", err)
	}
	defer file.Close()

	decoder := xml.NewDecoder(file)
	decoder.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
		return input, nil
	}

	var nfo NfoFile
	if err := decoder.Decode(&nfo); err != nil {
		return "", "", fmt.Errorf("xml decode failed: %w", err)
	}

	date := nfo.ReleaseDate
	if date == "" {
		date = nfo.Premiered
	}
	if nfo.Title == "" {
		nfo.Title = videoID
	}
	return nfo.Title, date, nil
}

// listVideosHandler 获取视频列表
func listVideosHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cacheMutex.RLock()
	defer cacheMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(videoListCache); err != nil {
		logger.Printf("Error encoding video list: %v", err)
		httpError(w, "Internal server error", http.StatusInternalServerError)
	}
}

// videoDetailHandler 获取视频详情
func videoDetailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	videoID := strings.TrimPrefix(r.URL.Path, "/api/videos/")
	if !validVideoID(videoID) {
		httpError(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// 详情缓存：目录 mtime 未变直接命中，跳过 ReadDir + NFO 解析 + 排序
	fanartDir := filepath.Join(getBasePath(), videoID)
	if st, err := os.Stat(fanartDir); err == nil && st.IsDir() {
		dirMtime := st.ModTime()
		detailCache.RLock()
		if cached, ok := detailCache.m[videoID]; ok && cached.dirMtime.Equal(dirMtime) {
			detail := cached.detail
			detailCache.RUnlock()
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			if err := json.NewEncoder(w).Encode(detail); err != nil {
				logger.Printf("Error encoding detail for %s: %v", videoID, err)
			}
			return
		}
		detailCache.RUnlock()
	}

	detail := VideoDetail{ID: videoID}
	startTime := time.Now()

	title, date, err := parseTitleAndDate(videoID)
	if err != nil {
		detail.Title = videoID
		detail.ReleaseDate = "Unknown"
	} else {
		detail.Title = title
		detail.ReleaseDate = date
	}

	// 查找fanart图片
	if entries, err := os.ReadDir(fanartDir); err == nil {
		type fanartFile struct {
			path   string
			num    int
			hasNum bool
		}
		var fanarts []fanartFile

		for _, entry := range entries {
			name := entry.Name()
			if !entry.IsDir() && strings.HasPrefix(name, videoID+"-fanart") &&
				strings.HasSuffix(name, ".jpg") {

				parts := strings.Split(name, "-fanart")
				if len(parts) < 2 {
					continue
				}

				numPart := strings.TrimSuffix(parts[1], ".jpg")
				numPart = strings.TrimPrefix(numPart, "-")

				var num int
				var hasNum bool
				if n, err := strconv.Atoi(numPart); err == nil {
					num = n
					hasNum = true
				}

				fanarts = append(fanarts, fanartFile{
					path:   fmt.Sprintf("/file/%s/%s", videoID, name),
					num:    num,
					hasNum: hasNum,
				})
			}
		}

		sort.Slice(fanarts, func(i, j int) bool {
			if fanarts[i].hasNum && fanarts[j].hasNum {
				return fanarts[i].num < fanarts[j].num
			}
			if fanarts[i].hasNum && !fanarts[j].hasNum {
				return true
			}
			if !fanarts[i].hasNum && fanarts[j].hasNum {
				return false
			}
			return fanarts[i].path < fanarts[j].path
		})

		for _, f := range fanarts {
			detail.Fanarts = append(detail.Fanarts, f.path)
		}
	}

	videoFile := filepath.Join(getBasePath(), videoID, videoID+".mp4")
	if _, err := os.Stat(videoFile); err == nil {
		detail.VideoFile = fmt.Sprintf("/file/%s/%s.mp4", videoID, videoID)
	}

	logger.Printf("Processed detail request for %s in %v", videoID, time.Since(startTime))

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(detail); err != nil {
		logger.Printf("Error encoding detail for %s: %v", videoID, err)
		httpError(w, "Internal server error", http.StatusInternalServerError)
	}
}

// imageHandler 处理图片请求
func imageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/file/"), "/")
	if len(pathParts) < 2 {
		httpError(w, "Invalid image path", http.StatusBadRequest)
		return
	}

	videoID := pathParts[0]
	filename := strings.Join(pathParts[1:], "/")
	if !validVideoID(videoID) || filename == "" {
		httpError(w, "Invalid image path", http.StatusBadRequest)
		return
	}
	basePath := filepath.Clean(getBasePath())
	imagePath := filepath.Join(basePath, videoID, filename)
	relPath, err := filepath.Rel(basePath, imagePath)
	if err != nil || relPath == "." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) || filepath.IsAbs(relPath) {
		httpError(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fileInfo, err := os.Stat(imagePath)
	if os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	} else if err != nil {
		logger.Printf("Error accessing file %s: %v", imagePath, err)
		httpError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	switch filepath.Ext(filename) {
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".mp4":
		w.Header().Set("Content-Type", "video/mp4")
	}

	logger.Printf("Serving file %s (Size: %d)", imagePath, fileInfo.Size())
	http.ServeFile(w, r, imagePath)
}

// addVideoHandler 新增下载队列
func addVideoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 鉴权与 CORS 由 securityGuard 统一处理（本机放行；非本机需 YINGBOX_API_KEY）。

	videoID := strings.TrimPrefix(r.URL.Path, "/api/addvideo/")
	if !validVideoID(videoID) {
		httpError(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	id := strings.ToUpper(string(videoID))
	if id == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}
	logger.Printf("Received ID: %s\n", id)

	dbDir := filepath.Join(scriptsDir, "db")
	dbPath := filepath.Join(dbDir, "downloaded.db")

	// 确保数据库目录存在
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		logger.Printf("Failed to create db directory: %v", err)
		httpError(w, "db directory creation failed", http.StatusInternalServerError)
		return
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		httpError(w, "db open failed", http.StatusInternalServerError)
		return
	}
	defer db.Close()

	// 确保数据库表存在
	if err := initDB(db); err != nil {
		logger.Printf("Failed to init database: %v", err)
		httpError(w, "db init failed", http.StatusInternalServerError)
		return
	}

	exists, err := checkStringExists(db, id)
	if err != nil {
		httpError(w, "db query failed", http.StatusInternalServerError)
		return
	}

	response := fmt.Sprintf("%s already downloaded", id)
	if !exists {
		if err := enqueueDownload(id); err != nil {
			httpError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		response = fmt.Sprintf("Add %s to download queue", id)
	}

	logger.Println(response)

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(response))
}

func validVideoID(id string) bool {
	if len(id) == 0 || len(id) > 80 {
		return false
	}
	for _, char := range id {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func initDB(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS MissAV (
		bvid TEXT PRIMARY KEY,
		downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	_, err := db.Exec(query)
	return err
}

func checkStringExists(db *sql.DB, target string) (bool, error) {
	var exists bool
	query := "SELECT EXISTS(SELECT 1 FROM MissAV WHERE bvid = ? LIMIT 1)"
	err := db.QueryRow(query, target).Scan(&exists)
	return exists, err
}

// isPrivateHost 判断主机是否指向内网/回环/链路本地地址。
//
// 用于阻断 /proxy 的 SSRF：避免把本服务当成访问内网服务（路由器、NAS、路由器管理页）的中转。
// DNS 解析失败时返回 false（放行）—— 刮削目标站点常需经由本地代理解析，
// 本地 DNS 失败是常态；而解析失败本身无法被用来指向内网，故不阻断。
func isPrivateHost(host string) bool {
	h := host
	if hh, _, err := net.SplitHostPort(host); err == nil {
		h = hh
	}
	h = strings.Trim(h, "[]")
	lower := strings.ToLower(h)
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") {
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return isPrivateIP(ip)
	}
	ips, err := net.LookupIP(h)
	if err != nil {
		return false
	}
	for _, ip := range ips {
		if isPrivateIP(ip) {
			return true
		}
	}
	return false
}

// isPrivateIP 判断 IP 是否属于不可对外访问的网段
func isPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

// scraperHost 判断目标是否属于已知刮削站点（仅对它们附带 JavBus 身份头，避免把会话 Cookie 泄露给任意站点）
func scraperHost(host string) bool {
	h := strings.ToLower(host)
	return strings.Contains(h, "javbus") || strings.Contains(h, "dmm") || strings.Contains(h, "awsimgsrc")
}

// proxyImageHandler 代理外部图片请求，绕过防盗链
func proxyImageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		httpError(w, "missing url", http.StatusBadRequest)
		return
	}

	target, err := url.ParseRequestURI(targetURL)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		httpError(w, "invalid url", http.StatusBadRequest)
		return
	}
	// SSRF 防护：默认拒绝内网目标（YINGBOX_ALLOW_PRIVATE_PROXY=1 可放开）
	if !allowPrivateSSRF && isPrivateHost(target.Host) {
		httpError(w, "proxy target not allowed", http.StatusForbidden)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		httpError(w, "invalid url", http.StatusBadRequest)
		return
	}
	// 仅对已知刮削站点附带身份头；否则会把 JavBus 会话 Cookie 泄露给任意第三方主机。
	if scraperHost(target.Host) {
		req.Header.Set("Referer", "https://www.javbus.com/")
		req.Header.Set("Cookie", "PHPSESSID=kesgcjj4fklf91ojbaocbkbao2; age=verified; existmag=mag")
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")

	var transport *http.Transport
	if proxyURL != "" {
		proxyAddr, _ := url.Parse(proxyURL)
		transport = &http.Transport{Proxy: http.ProxyURL(proxyAddr)}
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
		// 重定向同样要过 SSRF 检查，否则可被 302 绕过
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if !allowPrivateSSRF && isPrivateHost(req.URL.Host) {
				return fmt.Errorf("redirect target not allowed")
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		httpError(w, "fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		httpError(w, "upstream image request failed", http.StatusBadGateway)
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, resp.Body)
}

// metaHandler 从 javbus 抓取番号元数据
func metaHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	avid := strings.ToUpper(strings.TrimPrefix(r.URL.Path, "/api/meta/"))
	if !validVideoID(avid) {
		httpError(w, "missing avid", http.StatusBadRequest)
		return
	}

	stdout, stderr, err := runPythonContext(r.Context(), 60*time.Second, "tools/fetch_meta.py", []string{avid}, nil)
	if err != nil {
		logger.Printf("fetch_meta exec failed for %s: %v\nstderr: %s", avid, err, stderr)
	}

	jsonLine, _ := parsePythonJSON(stdout, stderr)
	if jsonLine == "" {
		logger.Printf("fetch_meta no json output for %s, stdout: %s, stderr: %s", avid, stdout, stderr)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "fetch meta failed",
			"log":   stdout + "\n" + stderr,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write([]byte(jsonLine))
}

// scrapeHandler 完整刮削：获取元数据 + 下载图片 + 生成 NFO
func scrapeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	avid := strings.ToUpper(strings.TrimPrefix(r.URL.Path, "/api/scrape/"))
	if !validVideoID(avid) {
		httpError(w, "missing avid", http.StatusBadRequest)
		return
	}

	// 1. 获取元数据
	stdout, stderr, err := runPythonContext(r.Context(), 60*time.Second, "tools/fetch_meta.py", []string{avid}, nil)
	if err != nil {
		logger.Printf("scrape fetch_meta failed for %s: %v\nstderr: %s", avid, err, stderr)
		httpError(w, "fetch meta failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonLine, _ := parsePythonJSON(stdout, stderr)
	if jsonLine == "" {
		logger.Printf("scrape: no json output for %s, stdout: %s, stderr: %s", avid, stdout, stderr)
		httpError(w, "fetch meta returned no data", http.StatusInternalServerError)
		return
	}

	var meta map[string]interface{}
	if err := json.Unmarshal([]byte(jsonLine), &meta); err != nil {
		httpError(w, "parse meta json failed", http.StatusInternalServerError)
		return
	}

	if errStr, ok := meta["error"].(string); ok && errStr != "" {
		logger.Printf("scrape: meta error for %s: %s", avid, errStr)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write([]byte(jsonLine))
		return
	}

	// 2. 创建目标目录
	targetDir := filepath.Join(getBasePath(), avid)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		logger.Printf("scrape: mkdir failed for %s: %v", avid, err)
		httpError(w, "mkdir failed", http.StatusInternalServerError)
		return
	}

	// 3. 下载封面
	if cover, ok := meta["cover"].(string); ok && cover != "" {
		posterPath := filepath.Join(targetDir, avid+"-poster.jpg")
		if err := downloadImage(cover, posterPath, avid); err != nil {
			logger.Printf("scrape: download cover failed for %s: %v", avid, err)
		} else {
			logger.Printf("scrape: cover saved to %s", posterPath)
		}
	}

	// 4. 下载 fanart 图片
	if fanarts, ok := meta["fanarts"].([]interface{}); ok {
		for i, f := range fanarts {
			fanartURL, ok := f.(string)
			if !ok || fanartURL == "" {
				continue
			}
			suffix := ""
			if i > 0 {
				suffix = fmt.Sprintf("-%d", i+1)
			}
			fanartPath := filepath.Join(targetDir, avid+"-fanart"+suffix+".jpg")
			if err := downloadImage(fanartURL, fanartPath, avid); err != nil {
				logger.Printf("scrape: download fanart %d failed for %s: %v", i, avid, err)
			}
		}
	}

	// 5. 下载演员头像
	if actress, ok := meta["actress"].(map[string]interface{}); ok {
		for name, avatarURL := range actress {
			avatarStr, ok := avatarURL.(string)
			if !ok || avatarStr == "" || strings.HasPrefix(avatarStr, "data:") {
				continue
			}
			ext := ".jpg"
			if strings.Contains(avatarStr, ".webp") {
				ext = ".webp"
			}
			actorPath := filepath.Join(targetDir, " actress-"+name+ext)
			if err := downloadImage(avatarStr, actorPath, avid); err != nil {
				logger.Printf("scrape: download actress %s failed: %v", name, err)
			}
		}
	}

	// 6. 生成 NFO 文件
	nfoContent := generateNfo(meta, avid)
	nfoPath := filepath.Join(targetDir, avid+".nfo")
	if err := os.WriteFile(nfoPath, []byte(nfoContent), 0644); err != nil {
		logger.Printf("scrape: write nfo failed for %s: %v", avid, err)
	} else {
		logger.Printf("scrape: nfo saved to %s", nfoPath)
	}

	// 7. 返回元数据
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write([]byte(jsonLine))
}

// vodSitesHandler 返回与解析器一致的内置 VOD 站点配置。
// 前端不再维护一份容易失效的硬编码副本。
func vodSitesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	config, err := pyScripts.ReadFile("py/vod.json")
	if err != nil {
		logger.Printf("read embedded vod config failed: %v", err)
		httpError(w, "VOD configuration unavailable", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"config":  json.RawMessage(config),
	})
}

// vodParseHandler VOD 播放地址解析
func vodParseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var reqMap map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&reqMap); err != nil {
		httpError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 确定操作类型
	action, _ := reqMap["action"].(string)
	if action == "" {
		action = "parse"
	}
	siteName, _ := reqMap["siteName"].(string)

	// 构建参数 - 传递所有字段给 Python
	argsMap := map[string]interface{}{}
	switch action {
	case "getConfig":
		// no extra args needed
	case "search":
		argsMap["text"] = reqMap["keyword"]
		argsMap["page"] = reqMap["page"]
		if argsMap["page"] == nil {
			argsMap["page"] = 1
		}
	case "getCards":
		// Pass all extra fields (id, url, page, ext, typeurl, etc.)
		for k, v := range reqMap {
			if k != "action" && k != "siteName" {
				argsMap[k] = v
			}
		}
		if argsMap["page"] == nil {
			argsMap["page"] = 1
		}
	case "getTracks":
		for k, v := range reqMap {
			if k != "action" && k != "siteName" {
				argsMap[k] = v
			}
		}
	case "getPlayinfo":
		// Pass all extra fields (vid, pkey, ref, url, etc.)
		for k, v := range reqMap {
			if k != "action" && k != "siteName" {
				argsMap[k] = v
			}
		}
	case "parse":
		argsMap["videoID"] = reqMap["videoID"]
		argsMap["episode"] = reqMap["episode"]
	}

	argsJSON, _ := json.Marshal(argsMap)
	args := []string{action, siteName, string(argsJSON)}

	// Pass PROJECT_ROOT so Python/Node can find node_modules
	// Go backend runs from packages/services/backend, node_modules is at project root
	projectRoot := os.Getenv("PROJECT_ROOT")
	if wd, err := os.Getwd(); err == nil && projectRoot == "" {
		// Walk up to find node_modules
		dir := wd
		for i := 0; i < 5; i++ {
			if _, err := os.Stat(filepath.Join(dir, "node_modules")); err == nil {
				projectRoot = dir
				break
			}
			dir = filepath.Dir(dir)
		}
	}
	if projectRoot == "" {
		projectRoot, _ = os.Getwd()
	}
	envExtra := map[string]string{
		"PROJECT_ROOT": projectRoot,
	}

	stdout, stderr, err := runPythonContext(r.Context(), 15*time.Second, "vod_parser.py", args, envExtra)
	if err != nil {
		logger.Printf("vod_parser exec failed: %v\nstderr: %s", err, stderr)
	}

	jsonLine, _ := parsePythonJSON(stdout, stderr)
	if jsonLine == "" {
		logger.Printf("vod_parser no json output, stdout: %s, stderr: %s", stdout, stderr)
		result := map[string]interface{}{
			"success": false,
			"error":   "vod parser failed",
			"log":     stdout + "\n" + stderr,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(result)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write([]byte(jsonLine))
}

// downloadImage 下载图片到本地
func downloadImage(imageURL, savePath string, avid string) error {
	if imageURL == "" {
		return nil
	}
	logger.Printf("downloadImage: %s -> %s", imageURL, savePath)

	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", "https://www.javbus.com/")

	var transport *http.Transport
	if proxyURL != "" {
		proxyAddr, parseErr := url.Parse(proxyURL)
		if parseErr == nil {
			transport = &http.Transport{Proxy: http.ProxyURL(proxyAddr)}
		}
	}
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http get failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http status %d", resp.StatusCode)
	}

	out, err := os.CreateTemp(filepath.Dir(savePath), ".image-*.partial")
	if err != nil {
		return fmt.Errorf("create file failed: %w", err)
	}
	temporary := out.Name()
	defer os.Remove(temporary)
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return fmt.Errorf("write file failed: %w", err)
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(temporary, savePath)
}

// generateNfo 根据元数据生成 NFO 内容
func generateNfo(meta map[string]interface{}, avid string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	b.WriteString("<movie>\n")

	title := avid
	if t, ok := meta["title"].(string); ok && t != "" {
		title = t
	}
	b.WriteString(fmt.Sprintf("  <title>%s</title>\n", escapeXML(title)))

	if orig, ok := meta["title"].(string); ok && orig != "" && orig != title {
		b.WriteString(fmt.Sprintf("  <originaltitle>%s</originaltitle>\n", escapeXML(orig)))
	}

	if rd, ok := meta["release_date"].(string); ok && rd != "" {
		b.WriteString(fmt.Sprintf("  <year>%s</year>\n", escapeXML(rd[:minInt(4, len(rd))])))
		b.WriteString(fmt.Sprintf("  <premiered>%s</premiered>\n", escapeXML(rd)))
	}

	if desc, ok := meta["description"].(string); ok && desc != "" {
		b.WriteString(fmt.Sprintf("  <plot>%s</plot>\n", escapeXML(desc)))
	}

	if actress, ok := meta["actress"].(map[string]interface{}); ok {
		for name := range actress {
			b.WriteString(fmt.Sprintf("  <actor><name>%s</name></actor>\n", escapeXML(name)))
		}
	}

	b.WriteString("</movie>")
	return b.String()
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// queueHandler 获取下载队列
func queueHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	queueFilePath := filepath.Join(scriptsDir, "db", "download_queue.txt")
	data, err := os.ReadFile(queueFilePath)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			json.NewEncoder(w).Encode([]string{})
			return
		}
		httpError(w, "read queue failed", http.StatusInternalServerError)
		return
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	queue := []string{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			queue = append(queue, line)
		}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(queue)
}

type completedDownload struct {
	ID          string `json:"id"`
	CompletedAt string `json:"completedAt"`
}

type downloadStatus struct {
	Failed    []string            `json:"failed"`
	Active    string              `json:"active"`
	Queued    []string            `json:"queued"`
	Completed []completedDownload `json:"completed"`
}

// downloadStatusHandler 返回当前任务、等待队列和最近完成记录。
func downloadStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status := downloadStatus{Queued: []string{}, Completed: []completedDownload{}, Failed: []string{}}
	if data, err := os.ReadFile(filepath.Join(scriptsDir, "work")); err == nil {
		value := strings.TrimSpace(string(data))
		if value != "" && value != "0" && value != "1" {
			status.Active = value
		}
	}

	if data, err := os.ReadFile(filepath.Join(scriptsDir, "db", "download_queue.txt")); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if value := strings.TrimSpace(line); value != "" {
				status.Queued = append(status.Queued, value)
			}
		}
	}

	downloadQueueMu.Lock()
	status.Active = activeDownload
	filteredQueue := []string{}
	for _, id := range status.Queued {
		if id != status.Active {
			filteredQueue = append(filteredQueue, id)
		}
	}
	status.Queued = filteredQueue
	downloadQueueMu.Unlock()
	downloadFailures.Range(func(key, _ interface{}) bool { status.Failed = append(status.Failed, key.(string)); return true })

	dbPath := filepath.Join(scriptsDir, "db", "downloaded.db")
	if db, err := sql.Open("sqlite", dbPath); err == nil {
		defer db.Close()
		if rows, queryErr := db.Query("SELECT bvid, downloaded_at FROM MissAV ORDER BY downloaded_at DESC LIMIT 20"); queryErr == nil {
			defer rows.Close()
			for rows.Next() {
				var item completedDownload
				if scanErr := rows.Scan(&item.ID, &item.CompletedAt); scanErr == nil {
					status.Completed = append(status.Completed, item)
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(status)
}

// httpError 统一的HTTP错误响应
func httpError(w http.ResponseWriter, message string, code int) {
	logger.Printf("HTTP Error %d: %s", code, message)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
