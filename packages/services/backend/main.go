package main

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "modernc.org/sqlite"
)

// 服务器配置
const (
	serverPort = ":31471"
	apiKey     = "IBHUSDBWQHJEJOBDSW"
	proxyURL   = "http://127.0.0.1:7897"
)

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

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
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

	handler := enableCORS(mux)

	// 6. 优雅关闭：收到 SIGINT/SIGTERM 时干净释放端口
	server := &http.Server{Addr: serverPort, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
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

	logger.Printf("Server started on port %s", serverPort)
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

// buildVideoListCache 构建视频列表缓存
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
	for _, file := range files {
		if !file.IsDir() {
			continue
		}
		info, err := file.Info()
		if err != nil {
			logger.Printf("Error getting info for %s: %v", file.Name(), err)
			continue
		}
		dirs = append(dirs, dirEntryWithInfo{entry: file, info: info})
	}

	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].info.ModTime().After(dirs[j].info.ModTime())
	})

	validCount := 0
	for _, dir := range dirs {
		posterPath := filepath.Join(getBasePath(), dir.entry.Name(), dir.entry.Name()+"-poster.jpg")
		if _, err := os.Stat(posterPath); err == nil {
			validCount++
		}
	}

	if validCount == len(videoListCache) {
		logger.Printf("Cache unchanged. Valid items: %d", validCount)
		return nil
	}

	videoListCache = nil
	var count int
	for _, dir := range dirs {
		videoID := dir.entry.Name()
		posterPath := filepath.Join(getBasePath(), videoID, videoID+"-poster.jpg")

		if _, err := os.Stat(posterPath); err != nil {
			continue
		}

		title, _, err := parseTitleAndDate(videoID)
		if err != nil {
			title = videoID
		}

		videoListCache = append(videoListCache, VideoItem{
			ID:     videoID,
			Title:  title,
			Poster: fmt.Sprintf("/file/%s/%s-poster.jpg", videoID, videoID),
		})
		count++
	}

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
	fanartDir := filepath.Join(getBasePath(), videoID)
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

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Authorization header missing", http.StatusUnauthorized)
		return
	}

	if !strings.HasPrefix(authHeader, "Bearer ") {
		http.Error(w, "Invalid authorization format", http.StatusUnauthorized)
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token != apiKey {
		http.Error(w, "Invalid API key", http.StatusUnauthorized)
		return
	}

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
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		httpError(w, "invalid url", http.StatusBadRequest)
		return
	}
	req.Header.Set("Referer", "https://www.javbus.com/")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Cookie", "PHPSESSID=kesgcjj4fklf91ojbaocbkbao2; age=verified; existmag=mag")
	req.Header.Set("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")

	var transport *http.Transport
	if proxyURL != "" {
		proxyAddr, _ := url.Parse(proxyURL)
		transport = &http.Transport{Proxy: http.ProxyURL(proxyAddr)}
	}
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second}
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
