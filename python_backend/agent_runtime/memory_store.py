from __future__ import annotations

import lancedb
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from agent_runtime.models import MemoryRecord


# LanceDB 连接路径
ROOT_DIR = Path(__file__).resolve().parents[2]
LANCEDB_PATH = ROOT_DIR / ".paperforge" / "lancedb"


class MemoryStore:
    """记忆存储系统 - 基于 LanceDB"""

    def __init__(self):
        self.db = lancedb.connect(str(LANCEDB_PATH))
        self.table = self._init_table()

    def _init_table(self):
        """初始化记忆表"""
        try:
            return self.db.open_table("memories")
        except Exception:
            # 表不存在，创建新表
            # LanceDB 需要至少一条记录来创建表
            # 重要：所有 Optional 字段必须使用空字符串而非 None，避免类型冲突
            # 如果初始记录的 source_mission_id=None，LanceDB 会推断为 Null 类型
            # 后续添加字符串值时会报错：cannot cast from Utf8 to Null
            now = datetime.now(timezone.utc).isoformat()
            initial_record = MemoryRecord(
                id="memory-init",
                scope="/system/init",
                title="System Initialization",
                summary="Memory system initialized",
                content="This is the first memory record to initialize the LanceDB table.",
                source_mission_id="",  # 使用空字符串而非 None，避免类型冲突
                promoted=False,
                created_at=now,
                updated_at=now,
            )
            return self.db.create_table("memories", data=[initial_record.model_dump()], mode="overwrite")

    # === 基础 CRUD ===

    def _sanitize_record(self, record: MemoryRecord) -> dict:
        """
        清理记录数据，确保 LanceDB 兼容性

        LanceDB 对字段类型敏感：
        - Optional 字段如果初始为 None，会被推断为 Null 类型
        - 后续添加字符串值时会报错：cannot cast from Utf8 to Null
        - 解决方案：将 None 转换为空字符串
        """
        data = record.model_dump()
        if data.get("source_mission_id") is None:
            data["source_mission_id"] = ""
        return data

    def add(self, record: MemoryRecord) -> MemoryRecord:
        """添加记忆"""
        data = self._sanitize_record(record)
        self.table.add([data])
        return record

    def get(self, memory_id: str) -> Optional[MemoryRecord]:
        """获取单个记忆"""
        try:
            results = self.table.search().where(f"id = '{memory_id}'").limit(1).to_pandas()
            if len(results) == 0:
                return None
            return MemoryRecord(**results.iloc[0].to_dict())
        except Exception:
            return None

    def list_by_scope(self, scope: str) -> List[MemoryRecord]:
        """按 Scope 查询记忆"""
        try:
            results = self.table.search().where(f"scope = '{scope}'").to_pandas()
            return [MemoryRecord(**row.to_dict()) for row in results.iloc]
        except Exception:
            return []

    def list_all(self, limit: int = 100) -> List[MemoryRecord]:
        """列出所有记忆"""
        try:
            results = self.table.search().limit(limit).to_pandas()
            return [MemoryRecord(**row.to_dict()) for row in results.iloc]
        except Exception:
            return []

    def delete(self, memory_id: str) -> bool:
        """删除记忆"""
        try:
            self.table.delete(f"id = '{memory_id}'")
            return True
        except Exception:
            return False

    def update(self, record: MemoryRecord) -> MemoryRecord:
        """更新记忆"""
        record.updated_at = datetime.now(timezone.utc).isoformat()
        # LanceDB 的 update 操作需要先删除再添加
        self.table.delete(f"id = '{record.id}'")
        data = self._sanitize_record(record)
        self.table.add([data])
        return record

    # === 认知操作 ===

    def remember(
        self,
        scope: str,
        title: str,
        summary: str,
        content: str,
        source_mission_id: Optional[str] = None,
        promoted: bool = False,
    ) -> MemoryRecord:
        """
        记忆操作：自动分析 scope，去重，解决矛盾

        Phase 2 简化实现：
        - 暂不实现 embedding 去重
        - 暂不实现矛盾解决
        - 只做基础的添加和重复标题检查
        """
        # 检查是否已存在相同标题的记忆（简化去重）
        try:
            existing = self.table.search().where(f"scope = '{scope}' AND title = '{title}'").limit(1).to_pandas()

            if len(existing) > 0:
                # 已存在，更新内容
                existing_record = MemoryRecord(**existing.iloc[0].to_dict())
                existing_record.content = content
                existing_record.summary = summary
                existing_record.updated_at = datetime.now(timezone.utc).isoformat()
                return self.update(existing_record)
        except Exception:
            pass

        # 创建新记忆
        now = datetime.now(timezone.utc).isoformat()
        record = MemoryRecord(
            id=f"memory-{int(datetime.now().timestamp() * 1000)}",
            scope=scope,
            title=title,
            summary=summary,
            content=content,
            source_mission_id=source_mission_id,
            promoted=promoted,
            created_at=now,
            updated_at=now,
        )
        return self.add(record)

    def recall(
        self,
        query: str,
        scope: Optional[str] = None,
        limit: int = 10,
    ) -> List[MemoryRecord]:
        """
        回忆操作：自适应检索

        Phase 2 简化实现：
        - 暂不实现向量搜索（embedding）
        - 使用关键词匹配 + Scope 过滤
        - 暂不实现 confidence threshold
        """
        try:
            if scope:
                results = self.table.search().where(f"scope = '{scope}'").limit(limit * 2).to_pandas()
            else:
                results = self.table.search().limit(limit * 2).to_pandas()

            # 简化关键词匹配（后续替换为向量搜索）
            records = [MemoryRecord(**row.to_dict()) for row in results.iloc]
            matched = [
                r
                for r in records
                if query.lower() in r.title.lower() or query.lower() in r.summary.lower() or query.lower() in r.content.lower()
            ]

            return matched[:limit]
        except Exception:
            return []

    def extract_memories(
        self,
        long_text: str,
        scope: str,
        source_mission_id: Optional[str] = None,
    ) -> List[MemoryRecord]:
        """
        提取记忆：长文本自动拆解为原子事实

        Phase 2 简化实现：
        - 暂不使用 LLM 自动拆解
        - 使用简单的分段处理（按段落或关键句子）
        """
        # 简化实现：按段落分割
        paragraphs = long_text.split("\n\n")
        records = []

        for i, paragraph in enumerate(paragraphs):
            if not paragraph.strip():
                continue

            now = datetime.now(timezone.utc).isoformat()
            record = MemoryRecord(
                id=f"memory-{int(datetime.now().timestamp() * 1000)}-{i}",
                scope=scope,
                title=f"Fragment {i+1}",
                summary=paragraph[:100] + "..." if len(paragraph) > 100 else paragraph,
                content=paragraph,
                source_mission_id=source_mission_id,
                promoted=False,
                created_at=now,
                updated_at=now,
            )
            self.add(record)
            records.append(record)

        return records

    def forget(self, scope: str, ttl_days: Optional[int] = None) -> bool:
        """
        遗忘操作：清理过期或无关记忆

        Phase 2 简化实现：
        - 按 Scope 删除（任务级记忆清理）
        - 按 TTL 删除过期记忆（可选）
        """
        try:
            if ttl_days:
                # 计算过期时间点
                cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
                cutoff_str = cutoff.isoformat()

                # 删除过期的非永久记忆
                self.table.delete(f"scope = '{scope}' AND promoted = false AND created_at < '{cutoff_str}'")
            else:
                # 删除整个 Scope 的非永久记忆
                self.table.delete(f"scope = '{scope}' AND promoted = false")

            return True
        except Exception:
            return False


# 全局实例
memory_store = MemoryStore()