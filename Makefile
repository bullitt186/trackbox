.PHONY: dev test lint build deploy

dev:
	source .venv/bin/activate && uvicorn main:app --reload

test:
	source .venv/bin/activate && pytest tests/ -q --cov=. --cov-fail-under=50

lint:
	source .venv/bin/activate && ruff check .

build:
	docker build --target test . && docker build --target production -t trackbox:local .

lock:
	source .venv/bin/activate && pip freeze > requirements.lock

openapi:
	source .venv/bin/activate && python3 -c "from main import app; import json; json.dump(app.openapi(), open('openapi.json','w'), indent=2)"

