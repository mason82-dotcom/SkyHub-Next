# MinIO + mc built from source for the host architecture (brix-node: amd64).
# Same releases as the Pi image skyhub/minio:RELEASE.2025-10-15T17-29-55Z-an1 (arm64):
#   minio RELEASE.2025-10-15T17-29-55Z (commit 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a), go1.24
#   mc    RELEASE.2025-08-13T08-35-41Z (commit 7394ce0dd2a80935aded936b09fa12cbb3cb8096)
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git
ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ENV CGO_ENABLED=0
RUN git clone --filter=blob:none https://github.com/minio/minio.git /src/minio \
 && cd /src/minio && git checkout "$MINIO_COMMIT" \
 && go build -trimpath -tags kqueue -o /out/minio \
      -ldflags "-s -w $(go run buildscripts/gen-ldflags.go $(echo $MINIO_RELEASE | sed -E 's/RELEASE\.([0-9-]+)T([0-9]+)-([0-9]+)-([0-9]+)Z/\1T\2:\3:\4Z/'))"
RUN git clone --filter=blob:none https://github.com/minio/mc.git /src/mc \
 && cd /src/mc && git checkout "$MC_COMMIT" \
 && go build -trimpath -o /out/mc \
      -ldflags "-s -w $(go run buildscripts/gen-ldflags.go $(echo $MC_RELEASE | sed -E 's/RELEASE\.([0-9-]+)T([0-9]+)-([0-9]+)-([0-9]+)Z/\1T\2:\3:\4Z/'))"

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/minio /out/mc /usr/bin/
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
