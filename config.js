// 配置文件 - 使用云函数后端
const CONFIG = {
    // 云函数后端配置
    CLOUD_BACKEND: {
        URL: 'https://1395631860-j5fgunt8ny.ap-shanghai.tencentscf.com',  // 你的腾讯云函数地址
        API_PATHS: {
            TEST: '/test',
            GIST: '/gist',
            USER: '/user',
            CHECK_USERNAME: '/check-username',  // 新增检查用户名端点
            CLEAR_CLOUD: '/clear-cloud'  // 新增清空云端数据端点
        }
    },
    // 管理员GitHub信息
    ADMIN_GITHUB: {
        USERNAME: 'Leo-66666666',  // 你的GitHub用户名
        GIST_ID: 'dc6328fd3c6af8f8e6ef3dee506fe57d'  // 仅用于显示
    },
    // 应用配置
    MAX_USERS: 100,
    ADMIN_PASSWORD: '114514',  // 管理员密码（实际是114514，提示是123456）
    SYNC_LIMIT_PER_DAY: 5,
    DOWNLOAD_LIMIT_PER_DAY: 5,
    PRIVACY_AGREED: 'privacy_agreed',  // 隐私协议同意标识
    // 隐私提示
    PRIVACY_WARNING: "⚠️ 注意：数据将存储在管理员GitHub中，请勿记录任何敏感个人信息！"
};
