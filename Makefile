.PHONY: dev test lint keys seed docker-build docker-up docker-down clean

dev:
	.venv/bin/uvicorn app.main:app --reload --port 8000

test:
	.venv/bin/python -m pytest -v

lint:
	.venv/bin/ruff check app scripts tests

keys:
	.venv/bin/python scripts/generate_keys.py

seed:
	.venv/bin/python scripts/seed_data.py

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; rm -rf .pytest_cache .ruff_cache
