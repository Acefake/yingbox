package main

import (
	"os"
	"os/exec"
)

// pythonExecutable 缓存解析出的解释器路径（进程内懒加载）
var pythonExecutable string

// resolvePythonExecutable 选择用于脚本执行的 Python 解释器。
//
// 优先级：
//  1. PYTHON_EXECUTABLE 环境变量（用户显式指定）
//  2. 平台常见安装位（pythonCandidatePaths，见平台差异文件）
//  3. PATH 里的 python（兜底；缺失时在调用处报错）
//
// 结果进程内缓存，避免每次脚本调用重复探测。
func resolvePythonExecutable() string {
	if pythonExecutable != "" {
		return pythonExecutable
	}
	if env := os.Getenv("PYTHON_EXECUTABLE"); env != "" {
		pythonExecutable = env
		return env
	}
	for _, exe := range pythonCandidatePaths() {
		if info, err := os.Stat(exe); err == nil && !info.IsDir() {
			logger.Printf("Using Python: %s", exe)
			pythonExecutable = exe
			return exe
		}
	}
	if _, err := exec.LookPath("python"); err == nil {
		logger.Printf("Using Python from PATH: python")
		pythonExecutable = "python"
		return "python"
	}
	logger.Printf("WARNING: no Python interpreter found; set PYTHON_EXECUTABLE to enable script calls")
	pythonExecutable = "python"
	return "python"
}
