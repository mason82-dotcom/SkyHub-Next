# SkyHub PPK geotagging service: dji-geotagger (geo-raypan, BSD-2-Clause) + RTKLIB 2.4.3 (T. Takasu, BSD-2-Clause).
# RTKLIB's console tools are built from a pinned source archive (the package would otherwise fetch Windows .exe files).
# Runs offline on an internal network: base data come from SAPOS RINEX uploads, broadcast ephemeris from the nav file.

FROM python:3.11.10-slim-bookworm AS rtklib
ARG RTKLIB_COMMIT=180043ee24b6d2b168f98b64be15f69d50046b1a
ARG RTKLIB_SHA256=e8231a6931b0c5d12fb26368572cd3fc515fbd09d4a1c7597ed4955f15a10113
RUN set -e; apt-get update; apt-get install -y --no-install-recommends gcc libc6-dev make curl ca-certificates; rm -rf /var/lib/apt/lists/*
RUN set -e; cd /tmp; \
    curl -fsSL -o rtklib.tar.gz "https://github.com/tomojitakasu/RTKLIB/archive/${RTKLIB_COMMIT}.tar.gz"; \
    echo "${RTKLIB_SHA256}  rtklib.tar.gz" | sha256sum -c -; \
    tar -xzf rtklib.tar.gz; cd "RTKLIB-${RTKLIB_COMMIT}/app/consapp"; \
    # Without the optional IERS tide model (Fortran library); dji-geotagger runs with pos1-tidecorr=off.
    sed -i -e 's/-DIERS_MODEL//' -e 's#[.][.]/[.][.]/[.][.]/[.][.]/lib/iers/gcc/iers[.]a##' -e 's/-lgfortran//' rnx2rtkp/gcc/makefile; \
    make -C convbin/gcc; make -C rnx2rtkp/gcc; \
    install -D -m 0755 convbin/gcc/convbin /out/convbin; install -D -m 0755 rnx2rtkp/gcc/rnx2rtkp /out/rnx2rtkp

FROM python:3.11.10-slim-bookworm
ARG DGT_VERSION=3.1.1
ARG DGT_SHA256=d16d60cf46bce3c874e6be9a1589b7441e92fb21200480b1d81f6b5e783b9b5b
RUN set -e; apt-get update; apt-get install -y --no-install-recommends curl ca-certificates; rm -rf /var/lib/apt/lists/*; \
    cd /tmp; curl -fsSL -o "dji_geotagger-${DGT_VERSION}-py3-none-any.whl" \
      "https://files.pythonhosted.org/packages/py3/d/dji-geotagger/dji_geotagger-${DGT_VERSION}-py3-none-any.whl"; \
    echo "${DGT_SHA256}  dji_geotagger-${DGT_VERSION}-py3-none-any.whl" | sha256sum -c -; \
    pip install --no-cache-dir --disable-pip-version-check "./dji_geotagger-${DGT_VERSION}-py3-none-any.whl"; \
    rm -f /tmp/*.whl; apt-get purge -y curl; apt-get autoremove -y
# The package looks for its tools in dji_geotagger/tools/RTKLIB/bin/ first.
COPY --from=rtklib /out/ /tmp/rtk/
RUN set -e; d=$(python -c "import dji_geotagger,os;print(os.path.join(os.path.dirname(dji_geotagger.__file__),'tools','RTKLIB','bin'))"); \
    mkdir -p "$d"; mv /tmp/rtk/convbin /tmp/rtk/rnx2rtkp "$d/"; rmdir /tmp/rtk; "$d/rnx2rtkp" -? >/dev/null 2>&1 || true; \
    useradd --system --uid 10001 --home /jobs ppk; mkdir -p /jobs; chown ppk:ppk /jobs
COPY ppk_server.py /app/ppk_server.py
USER ppk
WORKDIR /jobs
EXPOSE 8090
CMD ["python", "/app/ppk_server.py"]
