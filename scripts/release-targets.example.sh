# 复制为 release-targets.local.sh 并填入真实地址。local 文件已被 .gitignore 排除。
# 向 RELEASE_REGISTRIES append 私有推送目标。格式: "键|前缀|风格(flat|acr)"
RELEASE_REGISTRIES+=( "acr|<实例ID>.cn-<region>.personal.cr.aliyuncs.com/<命名空间>|acr" )
RELEASE_REGISTRIES+=( "intranet|<内网IP>:<端口>|flat" )
