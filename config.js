const CONFIG = {
    // 云函数后端配置
    CLOUD_BACKEND: {
        URL: 'https://1395631860-j5fgunt8ny.ap-shanghai.tencentscf.com',
        API_PATHS: {
            TEST: '/test',
            GIST: '/gist',
            USER: '/user',
            CHECK_USERNAME: '/check-username',
            CLEAR_CLOUD: '/clear-cloud'
        }
    },
    
    // 应用配置
    MAX_USERS: 100,
    ADMIN_PASSWORD: '114514',
    SYNC_LIMIT_PER_DAY: 5,     // 上传限制设为5次
    DOWNLOAD_LIMIT_PER_DAY: 5, // 下载限制设为5次
    PRIVACY_AGREED: 'privacy_agreed',
    
    // 隐私提示
    PRIVACY_WARNING: "⚠️ 注意：数据将存储在管理员GitHub中，请勿记录任何敏感个人信息！"
};
