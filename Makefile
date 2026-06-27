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
	# Generate a production-only lock file using an isolated venv so dev tools
	# (pytest, ruff, mypy, pip-audit) are never included in requirements.lock.
	python3 -m venv .venv-lock
	.venv-lock/bin/pip install --quiet -r requirements.txt
	.venv-lock/bin/pip freeze > requirements.lock
	rm -rf .venv-lock
	@echo "requirements.lock updated (prod deps only)"

openapi:
	source .venv/bin/activate && python3 -c "from main import app; import json; json.dump(app.openapi(), open('openapi.json','w'), indent=2)"

