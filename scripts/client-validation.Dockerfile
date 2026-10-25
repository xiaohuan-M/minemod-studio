FROM gradle:8.10.2-jdk21@sha256:963d59f7f22767da4efbcf46b661361b61af5fb88b0309da1071c4234c647eba
USER root
RUN --mount=type=secret,id=system_ca,required=true apt-get -o Acquire::https::CaInfo=/run/secrets/system_ca update && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::https::CaInfo=/run/secrets/system_ca install -y --no-install-recommends xvfb xauth xdotool x11-apps libgl1-mesa-dri libglx-mesa0 libxrandr2 libxrender1 libxcursor1 libxi6 libasound2 libnss3 ffmpeg && rm -rf /var/lib/apt/lists/*
USER gradle
