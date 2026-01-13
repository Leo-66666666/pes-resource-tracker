// 配置文件
const CONFIG = {
    // 管理员GitHub配置
    ADMIN_GITHUB: {
        USERNAME: 'YOUR_GITHUB_USERNAME',  // 你的GitHub用户名
        REPO: 'pes-resource-data',         // 数据仓库名
        BRANCH: 'main',
        TOKEN: 'YOUR_GITHUB_TOKEN',        // 你的GitHub Token
        GIST_ID: 'YOUR_GIST_ID'            // 存储所有用户数据的Gist ID
    },
    
    // 应用配置
    MAX_USERS: 100,
    ADMIN_PASSWORD: '114514',  // 修改为114514
    SYNC_LIMIT_PER_DAY: 1,     // 每天同步限制次数
    
    // 隐私提示
    PRIVACY_WARNING: "⚠️ 注意：数据将存储在管理员GitHub中，请勿存储任何敏感个人信息！"
};