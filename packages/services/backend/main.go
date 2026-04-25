package main

import (
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// 服务器配置
const (
	basePath   = "F:/新建文件夹"
	serverPort = ":31471"
	apiKey     = "IBHUSDBWQHJEJOBDSW"
	queuePath  = "../db/download_queue.txt"
	proxyURL   = "http://127.0.0.1:7897"
)

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

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 允许的域名（生产环境应替换为实际前端域名）
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// 允许的HTTP方法
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")

		// 允许的请求头
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// 允许携带Cookie（如果需要）
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		// 预检请求直接返回200
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	logger.Println("Starting MissAV server...")

	// 初始化缓存
	if err := buildVideoListCache(); err != nil {
		logger.Fatalf("Failed to build initial cache: %v", err)
	}

	// 启动定时缓存更新
	go startCacheUpdater(30 * time.Minute)

	// 设置路由
	mux := http.NewServeMux()
	mux.HandleFunc("/api/videos", listVideosHandler)
	mux.HandleFunc("/api/videos/", videoDetailHandler)
	mux.HandleFunc("/api/addvideo/", addVideoHandler)
	mux.HandleFunc("/api/queue", queueHandler)
	mux.HandleFunc("/api/meta/", metaHandler)
	mux.HandleFunc("/proxy", proxyImageHandler)
	mux.HandleFunc("/file/", imageHandler)

	// 包装CORS中间件
	handler := enableCORS(mux)

	logger.Printf("Server started on port %s", serverPort)
	log.Fatal(http.ListenAndServe(serverPort, handler))
}

// startCacheUpdater 定时更新缓存
func startCacheUpdater(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		logger.Println("Starting scheduled cache update...")
		if err := buildVideoListCache(); err != nil {
			logger.Printf("Cache update failed: %v", err)
		} else {
			logger.Println("Cache updated successfully")
		}
	}
}

// buildVideoListCache 构建视频列表缓存
func buildVideoListCache() error {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	startTime := time.Now()
	logger.Println("Building video list cache...")

	// 读取目录
	files, err := os.ReadDir(basePath)
	if err != nil {
		logger.Printf("Error reading directory %s: %v", basePath, err)
		return fmt.Errorf("read directory failed: %w", err)
	}

	type dirEntryWithInfo struct {
		entry os.DirEntry
		info  os.FileInfo
	}

	// 获取文件夹的修改时间信息
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

	// 按修改时间倒序排序（最新的在前面）
	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].info.ModTime().After(dirs[j].info.ModTime())
	})

	// 如果文件夹数量一致（且都是有效文件夹），则跳过重建
	validCount := 0
	for _, dir := range dirs {
		posterPath := filepath.Join(basePath, dir.entry.Name(), dir.entry.Name()+"-poster.jpg")
		if _, err := os.Stat(posterPath); err == nil {
			validCount++
		}
	}

	if validCount == len(videoListCache) {
		logger.Printf("Cache unchanged. Valid items: %d", validCount)
		return nil
	}

	// 清空现有缓存
	videoListCache = nil

	var count int
	for _, dir := range dirs {
		videoID := dir.entry.Name()
		posterPath := filepath.Join(basePath, videoID, videoID+"-poster.jpg")

		if _, err := os.Stat(posterPath); err != nil {
			logger.Printf("Poster not found for %s: %v", videoID, err)
			continue
		}

		title, _, err := parseTitleAndDate(videoID)
		if err != nil {
			logger.Printf("Failed to parse NFO for %s: %v", videoID, err)
			title = videoID
		}

		videoListCache = append(videoListCache, VideoItem{
			ID:     videoID,
			Title:  title,
			Poster: fmt.Sprintf("/file/%s/%s-poster.jpg", videoID, videoID),
		})
		count++
	}

	logger.Printf("Cache built successfully. Items: %d, Duration: %v",
		count, time.Since(startTime))
	return nil
}

// parseTitleAndDate 解析NFO文件获取标题和日期
func parseTitleAndDate(videoID string) (title, releaseDate string, err error) {
	nfoPath := filepath.Join(basePath, videoID, videoID+".nfo")

	// 使用os.Open确保能处理BOM头
	file, err := os.Open(nfoPath)
	if err != nil {
		return "", "", fmt.Errorf("open file failed: %w", err)
	}
	defer file.Close()

	// 创建UTF-8解码器（自动处理BOM头）
	decoder := xml.NewDecoder(file)
	decoder.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
		// 强制使用UTF-8，忽略文件声明的编码
		return input, nil
	}

	var nfo NfoFile
	if err := decoder.Decode(&nfo); err != nil {
		return "", "", fmt.Errorf("xml decode failed: %w", err)
	}

	// 确定发布日期
	date := nfo.ReleaseDate
	if date == "" {
		date = nfo.Premiered
	}

	// 确保标题不为空
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
	if videoID == "" {
		httpError(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	detail := VideoDetail{ID: videoID}
	startTime := time.Now()

	// 解析NFO文件
	title, date, err := parseTitleAndDate(videoID)
	if err != nil {
		logger.Printf("NFO parse for %s failed: %v", videoID, err)
		detail.Title = videoID
		detail.ReleaseDate = "Unknown"
	} else {
		detail.Title = title
		detail.ReleaseDate = date
	}

	// 查找fanart图片
	fanartDir := filepath.Join(basePath, videoID)
	if files, err := ioutil.ReadDir(fanartDir); err == nil {
		// 创建临时存储结构
		type fanartFile struct {
			path   string
			num    int
			hasNum bool
		}

		var fanarts []fanartFile

		for _, file := range files {
			name := file.Name()
			if !file.IsDir() && strings.HasPrefix(name, videoID+"-fanart") &&
				strings.HasSuffix(name, ".jpg") {

				// 提取文件名中的数字部分
				parts := strings.Split(name, "-fanart")
				if len(parts) < 2 {
					continue
				}

				numPart := strings.TrimSuffix(parts[1], ".jpg")
				numPart = strings.TrimPrefix(numPart, "-")

				var num int
				var hasNum bool

				// 尝试解析数字
				if n, err := strconv.Atoi(numPart); err == nil {
					num = n
					hasNum = true
				} else {
					// 没有数字的情况
					num = 0
					hasNum = false
				}

				fanarts = append(fanarts, fanartFile{
					path:   fmt.Sprintf("/file/%s/%s", videoID, name),
					num:    num,
					hasNum: hasNum,
				})
			}
		}

		// 排序
		sort.Slice(fanarts, func(i, j int) bool {
			// 都有数字的情况，按数字排序
			if fanarts[i].hasNum && fanarts[j].hasNum {
				return fanarts[i].num < fanarts[j].num
			}
			// 只有一个有数字的情况，有数字的排在前面
			if fanarts[i].hasNum && !fanarts[j].hasNum {
				return true
			}
			if !fanarts[i].hasNum && fanarts[j].hasNum {
				return false
			}
			// 都没有数字的情况，按原始文件名排序
			return fanarts[i].path < fanarts[j].path
		})

		// 将排序后的结果存入detail.Fanarts
		for _, f := range fanarts {
			detail.Fanarts = append(detail.Fanarts, f.path)
		}
	} else {
		logger.Printf("Error reading fanart dir for %s: %v", videoID, err)
	}

	// 检查视频文件
	videoFile := filepath.Join(basePath, videoID, videoID+".mp4")
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
	imagePath := filepath.Join(basePath, videoID, filename)

	// 安全检查
	if !strings.HasPrefix(filepath.Clean(imagePath), filepath.Clean(basePath)) {
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

	// 设置Content-Type
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

// downloadQueueHandler 新增下载队列
func addVideoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 从请求头获取API密钥
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Authorization header missing", http.StatusUnauthorized)
		return
	}

	// 验证API密钥
	if !strings.HasPrefix(authHeader, "Bearer ") {
		http.Error(w, "Invalid authorization format", http.StatusUnauthorized)
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token != apiKey {
		http.Error(w, "Invalid API key", http.StatusUnauthorized)
		return
	}

	// 读取请求体
	videoID := strings.TrimPrefix(r.URL.Path, "/api/addvideo/")
	if videoID == "" {
		httpError(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// 将请求体转换为字符串，强制大写
	id := strings.ToUpper(string(videoID))
	if id == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}
	logger.Printf("Received ID: %s\n", id)

	// 检查sqlite里面是否有这个车牌号
	db, err := sql.Open("sqlite", "../db/downloaded.db")
	if err != nil {
		httpError(w, "db open failed", http.StatusInternalServerError)
		return
	}
	defer db.Close()

	exists, err := checkStringExists(db, id)
	if err != nil {
		httpError(w, "db query failed", http.StatusInternalServerError)
		return
	}

	response := fmt.Sprintf("%s already downloaded", id)
	// 执行Python脚本
	if !exists {
		response = fmt.Sprintf("Add %s to download queue", id)
		go func() {
			projectRoot := filepath.Join(filepath.Dir(os.Args[0]), "..")
			cmd := exec.Command("python", filepath.Join(projectRoot, "main.py"), id)
			cmd.Dir = projectRoot
			err := cmd.Run()
			if err != nil {
				logger.Printf("command exec failed: %v", err)
			} else {
				logger.Printf("command exec succ!")
			}
		}()
	}
	logger.Println(response)

	// 设置响应内容类型
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(response))
}

func checkStringExists(db *sql.DB, target string) (bool, error) {
	var exists bool
	query := "SELECT EXISTS(SELECT 1 FROM MissAV WHERE bvid = ? LIMIT 1)"
	err := db.QueryRow(query, target).Scan(&exists)
	return exists, err
}

// proxyImageHandler 代理外部图片请求，绕过防盗链
func proxyImageHandler(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		httpError(w, "missing url", http.StatusBadRequest)
		return
	}

	req, err := http.NewRequest("GET", targetURL, nil)
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
	client := &http.Client{Transport: transport}
	resp, err := client.Do(req)
	if err != nil {
		httpError(w, "fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, resp.Body)
}

// metaHandler 从javbus抓取番号元数据
func metaHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	avid := strings.ToUpper(strings.TrimPrefix(r.URL.Path, "/api/meta/"))
	if avid == "" {
		httpError(w, "missing avid", http.StatusBadRequest)
		return
	}

	projectRoot, err := os.Getwd()
	if err != nil {
		httpError(w, "get workdir failed", http.StatusInternalServerError)
		return
	}
	cmd := exec.Command("python", filepath.Join(projectRoot, "tools", "fetch_meta.py"), avid)
	cmd.Dir = projectRoot
	out, runErr := cmd.CombinedOutput()
	if runErr != nil {
		logger.Printf("fetch_meta exec failed for %s: %v, output: %s", avid, runErr, string(out))
	}

	// 取最后一行JSON（忽略loguru的debug输出）
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	jsonLine := ""
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "{") {
			jsonLine = line
			break
		}
	}
	if jsonLine == "" {
		logger.Printf("fetch_meta no json output for %s, output: %s", avid, string(out))
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "fetch meta failed",
			"log":   string(out),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write([]byte(jsonLine))
}

// queueHandler 获取下载队列
func queueHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	data, err := os.ReadFile(queuePath)
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

// httpError 统一的HTTP错误响应
func httpError(w http.ResponseWriter, message string, code int) {
	logger.Printf("HTTP Error %d: %s", code, message)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
