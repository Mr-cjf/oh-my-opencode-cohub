#!/usr/bin/env python3
"""
OpenCode 数据库 time 字段修复工具

用途：
  降级到 1.17.20 后，如果数据库中有记录缺少顶层 $.time 字段，
  OpenCode 在读取时可能崩溃（"Cannot read properties of undefined (reading 'time')"）。
  本脚本扫描、备份并补全这些缺失的记录。

风险：
  - 脚本是幂等的——只会补全 json_extract(data,'$.time') IS NULL 的记录，
    不会覆盖已有的 time 字段。
  - 不会做全库备份（数据库可达 45GB），只导出受影响的行到 JSONL 文件用于回滚。

回滚方法：
  如果补丁后出现问题，可以用导出的 time-fields-backup-<ts>.jsonl 恢复：
    1. 每行是 {"id": <int>, "data": <原始 JSON 字符串>}
    2. 使用 SQL: UPDATE events SET data=? WHERE id=? 逐条恢复

用法：
  python fix-db-time-fields.py                    # 默认路径，交互确认
  python fix-db-time-fields.py --db <path>        # 指定数据库路径
  python fix-db-time-fields.py --dry-run           # 只统计，不修改
  python fix-db-time-fields.py --yes              # 跳过确认，直接修复

依赖：
  仅 Python 标准库（sqlite3, json, datetime, argparse）
"""

import sqlite3
import json
import argparse
import os
import sys
import datetime
import time as time_module


# 需要检查的 record_type 列表
RECORD_TYPES = [
    "step-start",
    "step-finish",
    "text",
    "patch",
    "agent",
    "file",
    "compaction",
    "tool",
]

# step-start 只需补 start；其余补 start + end
STEP_START_TYPES = {"step-start"}

# 默认数据库路径
DEFAULT_DB = os.path.join(
    os.path.expanduser("~"),
    ".local", "share", "opencode", "opencode.db"
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="修复 OpenCode 数据库缺少 $.time 字段的记录"
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB,
        help=f"SQLite 数据库路径（默认: {DEFAULT_DB}）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只统计受影响行数，不执行任何修改",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="跳过确认提示，直接执行修复",
    )
    return parser.parse_args()


def connect_db(db_path):
    """连接数据库并设置 busy_timeout"""
    if not os.path.isfile(db_path):
        print(f"[错误] 数据库文件不存在: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA busy_timeout=120000")
    conn.row_factory = sqlite3.Row
    return conn


def check_db_accessible(conn):
    """验证数据库可访问并包含 events 表"""
    try:
        cursor = conn.execute("SELECT COUNT(*) FROM events")
        total = cursor.fetchone()[0]
        print(f"[信息] 数据库连接成功，events 表共 {total} 行记录")
        return total
    except sqlite3.Error as e:
        print(f"[错误] 无法访问 events 表: {e}")
        sys.exit(1)


def count_missing_time(conn, record_type=None):
    """统计指定类型中缺少 $.time 的记录数"""
    if record_type:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM events "
            "WHERE record_type=? AND json_extract(data,'$.time') IS NULL",
            (record_type,),
        )
    else:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM events "
            "WHERE json_extract(data,'$.time') IS NULL"
        )
    return cursor.fetchone()[0]


def count_missing_time_by_type(conn):
    """按类型统计缺少 $.time 的记录数"""
    results = {}
    for rtype in RECORD_TYPES:
        count = count_missing_time(conn, rtype)
        if count > 0:
            results[rtype] = count

    # 也统计其他类型（不在预定义列表中的）
    cursor = conn.execute(
        "SELECT record_type, COUNT(*) as cnt FROM events "
        "WHERE json_extract(data,'$.time') IS NULL "
        "GROUP BY record_type ORDER BY cnt DESC"
    )
    for row in cursor.fetchall():
        if row["record_type"] not in results:
            results[row["record_type"]] = row["cnt"]

    return results


def export_affected_rows(conn, db_path, dry_run=False):
    """导出所有受影响的行到 JSONL 备份文件"""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = os.path.dirname(os.path.abspath(db_path))
    backup_file = os.path.join(backup_dir, f"time-fields-backup-{timestamp}.jsonl")

    cursor = conn.execute(
        "SELECT id, data FROM events "
        "WHERE json_extract(data,'$.time') IS NULL"
    )

    count = 0
    with open(backup_file, "w", encoding="utf-8") as f:
        for row in cursor:
            f.write(json.dumps({"id": row["id"], "data": row["data"]}, ensure_ascii=False) + "\n")
            count += 1

    if count > 0:
        size_mb = os.path.getsize(backup_file) / (1024 * 1024)
        print(f"[信息] 已导出 {count} 行到: {backup_file} ({size_mb:.2f} MB)")
    else:
        # 空文件，删除
        os.remove(backup_file)
        print("[信息] 无受影响行，跳过导出。")

    return backup_file, count


def fix_record_time(row):
    """为一条记录补上 time 字段，返回新 data 或 None"""
    try:
        data = json.loads(row["data"])
    except (json.JSONDecodeError, TypeError):
        return None

    # 再次检查（幂等）
    if "time" in data and data["time"] is not None:
        return None

    record_type = row.get("record_type", "")
    now_ts = time_module.time()

    if record_type in STEP_START_TYPES:
        # step-start 只补 start
        data["time"] = {"start": now_ts}
    else:
        # 其余补 start + end
        data["time"] = {"start": now_ts, "end": now_ts}

    return json.dumps(data, ensure_ascii=False)


def fix_all_missing(conn, dry_run=False):
    """逐类型分批修复缺少 time 的记录"""
    total_fixed = 0
    total_errors = 0

    for rtype in RECORD_TYPES:
        cursor = conn.execute(
            "SELECT id, record_type, data FROM events "
            "WHERE record_type=? AND json_extract(data,'$.time') IS NULL",
            (rtype,),
        )
        rows = cursor.fetchall()
        if not rows:
            print(f"[信息] [{rtype}] 无需修复")
            continue

        batch_size = 200
        fixed = 0

        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            for row in batch:
                new_data = fix_record_time(row)
                if new_data is None:
                    continue
                if not dry_run:
                    try:
                        conn.execute(
                            "UPDATE events SET data=? WHERE id=? AND json_extract(data,'$.time') IS NULL",
                            (new_data, row["id"]),
                        )
                        fixed += 1
                    except sqlite3.Error as e:
                        print(f"[警告] 更新 id={row['id']} 失败: {e}")
                        total_errors += 1

            if not dry_run:
                conn.commit()
                print(
                    f"[进度] [{rtype}] 已修复 {fixed}/{len(rows)} 条"
                    f"（批次 {i // batch_size + 1}/{(len(rows) - 1) // batch_size + 1}）"
                )

        total_fixed += fixed
        if dry_run:
            print(f"[信息] [{rtype}] 将修复 {len(rows)} 条")

    return total_fixed, total_errors


def print_summary(missing_before, missing_after, total_fixed, total_errors, dry_run):
    """打印修复摘要"""
    print("")
    print("=" * 60)
    if dry_run:
        print("[摘要] 仅统计模式（--dry-run），未修改任何数据")
    else:
        print("[摘要] 修复完成")
    print("=" * 60)

    if missing_before:
        print("\n修复前缺失统计:")
        for rtype, cnt in sorted(missing_before.items()):
            print(f"  {rtype}: {cnt}")

    if not dry_run and missing_after:
        print("\n修复后剩余缺失统计:")
        remaining = {k: v for k, v in missing_after.items() if v > 0}
        if remaining:
            for rtype, cnt in sorted(remaining.items()):
                print(f"  {rtype}: {cnt}")
        else:
            print("  全部已修复！")

    print(f"\n总计修复: {total_fixed}")
    if total_errors > 0:
        print(f"[警告] 错误数: {total_errors}")

    if not dry_run and total_fixed > 0:
        print("\n[提示] 如需回滚，使用导出的 JSONL 文件逐条恢复。")


def main():
    args = parse_args()
    db_path = os.path.abspath(args.db)

    print(f"[信息] 数据库路径: {db_path}")
    print(f"[信息] 工作模式: {'仅统计(--dry-run)' if args.dry_run else '修复模式'}")
    print("")

    conn = connect_db(db_path)
    total = check_db_accessible(conn)

    # 统计缺失情况
    print("\n[步骤 1/4] 扫描缺失 $.time 的记录...")
    missing_before = count_missing_time_by_type(conn)
    total_missing = sum(missing_before.values())

    if total_missing == 0:
        print("[结果] 数据库完好，未发现缺少 time 字段的记录。无需修复。")
        conn.close()
        return

    print(f"[结果] 共 {total_missing} 条记录缺少 $.time 字段:")
    for rtype, cnt in sorted(missing_before.items()):
        print(f"  {rtype}: {cnt}")

    # 提示关闭 OpenCode
    print("\n[步骤 2/4] 确认...")
    if not args.yes and not args.dry_run:
        print("[注意] 请确保 OpenCode 已关闭，否则写操作可能导致数据冲突。")
        answer = input("继续修复？(y/N): ").strip().lower()
        if answer not in ("y", "yes"):
            print("[取消] 用户取消了操作。")
            conn.close()
            return

    # 导出备份
    print("\n[步骤 3/4] 导出受影响行到 JSONL 备份...")
    backup_file, exported_count = export_affected_rows(conn, db_path, args.dry_run)

    # 执行修复
    print("\n[步骤 4/4] 执行修复...")
    total_fixed, total_errors = fix_all_missing(conn, args.dry_run)

    # 重新统计
    if not args.dry_run:
        conn.commit()
        missing_after = count_missing_time_by_type(conn)
    else:
        missing_after = missing_before

    print_summary(missing_before, missing_after, total_fixed, total_errors, args.dry_run)

    conn.close()


if __name__ == "__main__":
    main()