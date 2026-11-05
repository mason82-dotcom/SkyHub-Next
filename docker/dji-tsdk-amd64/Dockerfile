# DJI Thermal SDK service for x86-64 hosts (brix-node): dji_irp runs natively, no box64/qemu.
# Same sdk_server.py and same user/port as docker/dji-tsdk-box64; only the command differs
# (SKYHUB_TSDK_COMMAND, set in docker-compose.brix.yml).
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libstdc++6 libgomp1 libexif12 python3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10790 --no-create-home --shell /usr/sbin/nologin tsdk
ENV LD_LIBRARY_PATH=/sdk/bin:/sdk
COPY sdk_server.py /app/sdk_server.py
USER 10790:10790
EXPOSE 8790
CMD ["python3", "/app/sdk_server.py"]
