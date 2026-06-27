FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS test
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
RUN ruff check . && pytest tests/ -q && pip-audit --strict --progress-spinner off -r requirements.txt

FROM base AS production
ARG VERSION=dev
ENV TRACKBOX_VERSION=${VERSION}
RUN adduser -D -u 1000 app
COPY . .
RUN chown -R app:app /app
USER app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
