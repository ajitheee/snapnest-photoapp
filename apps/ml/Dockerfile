FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only torch first (smaller), then the rest
RUN pip install --no-cache-dir \
    torch==2.2.1 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

# Model cache directory — mount as a volume to persist across restarts
ENV HF_HOME=/model-cache/huggingface
ENV INSIGHTFACE_HOME=/model-cache/insightface

EXPOSE 3003

ENV TOKENIZERS_PARALLELISM=false

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3003", "--timeout-keep-alive", "120"]
