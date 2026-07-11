FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV BOOKS_DATABASE_URL=sqlite:////data/books.db \
    BOOKS_STORAGE_PATH=/data/storage \
    BOOKS_MAX_UPLOAD_MB=200
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
