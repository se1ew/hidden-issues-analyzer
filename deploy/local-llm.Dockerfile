# Official llama.cpp b12098 CPU release, x86-64. No GPU stack or media packages.
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS package
ADD --checksum=sha256:7e6f56a0940e5db3744a766ba5480ab5e0ba30b61b656b682f3919666da6aae7 https://github.com/ggml-org/llama.cpp/releases/download/b12098/llama-b12098-bin-ubuntu-x64.tar.gz /runtime.tar.gz
RUN mkdir /runtime && tar -xzf /runtime.tar.gz -C /runtime --strip-components=1

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=package /runtime/ /app/
RUN /app/llama-server --version
COPY deploy/local-llm.sh /entrypoint.sh
LABEL org.opencontainers.image.version="llama.cpp-b12098"
USER 65534:65534
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
