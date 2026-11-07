# DJI Thermal SDK (dji_irp, x86-64 only) on the Raspberry Pi 5 via box64.
# Build:  docker build -t skyhub-dji-box64:trixie docker/dji-tsdk-box64
# Ad-hoc runs: scripts/dji-tsdk-run.sh. Service: compose profile "thermal-sdk" (sdk_server.py, internal only).
# The SDK itself is NOT part of the image (DJI license); it is mounted read-only at /sdk.
# Why box64: qemu-user aborts dji_irp with SIGSEGV on the Pi 5 (16 KiB kernel pages); box64 runs it.

# x86-64 user-space libraries required by the SDK (installed under emulation, copied as data only).
FROM --platform=linux/amd64 debian:bookworm-slim AS x64
RUN apt-get update \
 && apt-get install -y --no-install-recommends libstdc++6 libgomp1 libexif12 \
 && rm -rf /var/lib/apt/lists/*

# Native arm64 runtime: box64 from Debian trixie plus native libs that box64 wraps.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends box64 libgomp1 libexif12 python3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10790 --no-create-home --shell /usr/sbin/nologin tsdk
COPY --from=x64 /usr/lib/x86_64-linux-gnu/ /opt/x64/lib/
ENV BOX64_LD_LIBRARY_PATH=/sdk/bin:/sdk:/opt/x64/lib \
    BOX64_LOG=0 \
    BOX64_NOBANNER=1
COPY sdk_server.py /app/sdk_server.py
USER 10790:10790
EXPOSE 8790
CMD ["python3", "/app/sdk_server.py"]
