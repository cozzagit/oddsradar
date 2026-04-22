"""Redis queue publisher — push RawEventSnapshot per il consumer Node."""
import json
from datetime import datetime

import redis

from .config import settings
from .models import RawEventSnapshot

_client: redis.Redis | None = None

QUEUE_KEY = "oddsradar:scrape_queue"
RUN_LOG_KEY = "oddsradar:ingestion_runs"


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def _default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError(f"Not serializable: {type(o)}")


def push_snapshot(snapshot: RawEventSnapshot) -> None:
    client = get_client()
    payload = json.loads(snapshot.model_dump_json())
    client.lpush(QUEUE_KEY, json.dumps(payload, default=_default))


def push_run_log(book_slug: str, items_fetched: int, errors: int, status: str) -> None:
    client = get_client()
    client.lpush(
        RUN_LOG_KEY,
        json.dumps(
            {
                "book_slug": book_slug,
                "items_fetched": items_fetched,
                "errors": errors,
                "status": status,
                "finished_at": datetime.utcnow().isoformat(),
            }
        ),
    )
