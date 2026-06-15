# 复制为 release-mirrors.local.sh 启用国内镜像源加速。local 文件已被 .gitignore 排除。
# 留空或不创建 local 文件 = 用官方源（pypi.org / deb.debian.org）。
export PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
export PIP_EXTRA_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple/"
export APT_MIRROR="http://mirrors.aliyun.com"
export NPM_REGISTRY="https://registry.npmmirror.com"
