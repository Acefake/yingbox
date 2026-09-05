from src import downloaderMgr
from src.comm import *
from src import data
from src.task_lock import acquire_task_lock
import sys
import argparse
from metadata import *

def append_if_not_duplicate(filename, new_content):
    new_content = new_content.strip()
    try:
        with open(filename, 'r', encoding='utf-8') as file:
            existing_lines = [line.strip() for line in file.readlines()]
    except FileNotFoundError:
        existing_lines = []
    
    if new_content not in existing_lines:
        with open(filename, 'a', encoding='utf-8') as file:
            file.write(new_content + '\n')
        return True
    else:
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process some parameters.")
    
    parser.add_argument('-f', '--force', action='store_true', help='跳过DB检查，强制执行')
    parser.add_argument('-t', '--target', type=str, help='指定车牌号')
    
    args, unknown = parser.parse_known_args()
    if not args and not unknown:
        logger.error(f"Error: Unknown arguments are not allowed: {args, unknown}")
        sys.exit(1)
    
    # 获取位置参数
    positional_args = [arg for arg in sys.argv[1:] if not arg.startswith('-')]
    
    if len(positional_args) == 1:
        args.target = positional_args[0]
    elif args.target is None:
        logger.error("需要提供车牌号")
        sys.exit(1)
    
    logger.info(f"Force: {args.force}")
    logger.info(f"Target: {args.target}")

    data.initialize_db(downloaded_path, "MissAV")
    if len(sys.argv) < 2:
        print("用法: python main.py <车牌号>")
        sys.exit(1)

    avid = args.target.upper()

    if not args.force:
        if data.find_in_db(avid, downloaded_path, "MissAV"):
            logger.info(f"{avid} 已在小姐姐数据库中")
            exit(0)
            
    logger.info(f"开始执行 车牌号: {avid}")

    task_lock = acquire_task_lock("work.lock")
    if task_lock is None:
        if os.environ.get("YINGBOX_QUEUE_MANAGED") == "1":
            logger.error("Another downloader process is active")
            sys.exit(1)
        append_if_not_duplicate(queue_path, avid)
        sys.exit(0)
    # The OS lock proves no other process owns a stale work marker.
    with open("work", "w", encoding="utf-8") as f:
        f.write(avid)

    mgr = downloaderMgr.DownloaderMgr()
    try:
        # 按照配置好的下载器顺序，依次尝试
        if len(sorted_downloaders) == 0:
            raise ValueError(f"cfg没有配置下载器：{sorted_downloaders}")
        
        count = 0
        for it in sorted_downloaders:
            count += 1
            downloader = mgr.GetDownloader(it["downloaderName"])
            if downloader is None:
                logger.error(f"Downloader not found: {it['downloaderName']}")
                continue
            if not downloader.setDomain(it["domain"]): # 设置成配置中的域名
                logger.error(f"下载器 {downloader.getDownloaderName()} 的域名没有配置")
                continue
            logger.info(f"尝试使用Downloader: {downloader.getDownloaderName()} 下载")
            lastDownloader = downloader

            # 下载失败使用下一个downloader
            info = downloader.downloadInfo(avid)
            if not info:
                logger.error(f"{avid} 下载元数据失败")
                if count >= len(sorted_downloaders):
                    raise ValueError(f"{avid} 下载元数据失败")
                continue
            logger.info(info)
            if not downloader.downloadM3u8(info.m3u8, avid):
                logger.error(f"{info.m3u8} 下载视频失败")
                if count >= len(sorted_downloaders):
                    raise ValueError(f"{info.m3u8} 下载视频失败")
                continue
            break
        else:
            raise ValueError("所有下载器均未成功下载")
            
        # 元数据只尝试下载一次，且只使用配置中权重最大的刮削器
        gen_nfo()
            
    except Exception as e:
        logger.error(e)
        if os.environ.get("YINGBOX_QUEUE_MANAGED") != "1":
            append_if_not_duplicate(queue_path, avid)
        sys.exit(1)

    finally: # 一定要执行
        with open("work", "w") as f:
            f.write("0")
        task_lock.close()
