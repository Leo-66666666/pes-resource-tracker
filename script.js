// 配置验证（添加到文件开头，DOMContentLoaded之前）
function validateConfig() {
    console.log('=== 配置验证 ===');
    console.log('云函数地址:', CONFIG.CLOUD_BACKEND.URL);
    console.log('API路径:', CONFIG.CLOUD_BACKEND.API_PATHS);
    console.log('GitHub用户名:', CONFIG.ADMIN_GITHUB.USERNAME);
    console.log('GIST_ID:', CONFIG.ADMIN_GITHUB.GIST_ID);
    console.log('最大用户数:', CONFIG.MAX_USERS);
    console.log('=== 验证结束 ===');
}

// 立即执行验证
setTimeout(validateConfig, 100);

// 状态管理
let currentUser = null;
let currentDate = new Date().toISOString().split('T')[0];
let userData = {
    username: '',
    password: '',
    createdAt: '',
    lastLogin: '',
    syncInfo: {
        lastSyncDate: '',
        syncCountToday: 0,
        storageMode: 'local'  // 'local' 或 'cloud'
    },
    records: {}
};

// 新增：用户名缓存
let usernameCache = {
    users: [],
    lastUpdated: null,
    isLoading: false
};

let cloudSyncManager = null;

// 云函数同步管理器
class CloudSyncManager {
    constructor() {
        console.log('正在初始化CloudSyncManager...');
        this.baseURL = CONFIG.CLOUD_BACKEND.URL;
        this.apiPaths = CONFIG.CLOUD_BACKEND.API_PATHS;
        
        // 检查配置
        if (!this.baseURL || this.baseURL.includes('你的云函数地址')) {
            console.error('云函数配置错误:');
            console.error('请设置正确的云函数地址');
            throw new Error('云函数配置不完整，请在CONFIG.CLOUD_BACKEND中设置URL');
        }
        
        console.log('云函数配置验证通过:', {
            baseURL: this.baseURL,
            apiPaths: this.apiPaths
        });
        
        this.maxRetries = 2;
        this.retryDelay = 1000; // 1秒
        
        console.log('CloudSyncManager初始化完成');
    }
    
    // 构建完整URL
    buildUrl(path) {
        return `${this.baseURL}${path}`;
    }
    
    // 发送请求（带重试）
    async sendRequest(url, options = {}, retryCount = 0) {
        try {
            console.log(`发送请求到: ${url}`, options.method || 'GET');
            
            // 添加默认请求头
            const requestOptions = {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...options.headers
                },
                mode: 'cors',
                cache: 'no-cache'
            };
            
            const response = await fetch(url, requestOptions);
            
            console.log(`响应状态: ${response.status} ${response.statusText}`);
            
            if (!response.ok) {
                // 如果是5xx错误，重试
                if (response.status >= 500 && retryCount < this.maxRetries) {
                    console.log(`服务器错误 ${response.status}，第${retryCount + 1}次重试...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    return this.sendRequest(url, options, retryCount + 1);
                }
                
                // 其他错误，直接抛出
                const errorText = await response.text();
                console.error(`HTTP错误 ${response.status}:`, errorText.substring(0, 200));
                
                if (response.status === 401 || response.status === 403) {
                    throw new Error('访问被拒绝，请检查云函数配置');
                }
                
                if (response.status === 404) {
                    throw new Error('云函数接口不存在，请检查路径配置');
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            }
            
            return response;
            
        } catch (error) {
            console.error(`请求失败:`, error.message);
            
            // 网络错误，重试
            if (retryCount < this.maxRetries && !error.message.includes('HTTP')) {
                console.log(`网络错误，第${retryCount + 1}次重试...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.sendRequest(url, options, retryCount + 1);
            }
            
            throw error;
        }
    }
    
   // 测试连接
    async testConnection() {
        console.log('开始测试云函数连接...');
        
        try {
            const testUrl = `${this.baseURL}/test`;
            console.log('测试URL:', testUrl);
            
            const response = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('响应状态:', response.status, response.statusText);
            
            const result = await response.json();
            console.log('完整响应:', result);
            
            // 检查响应结构
            if (result.success) {
                // 云函数返回的结构是 {success: true, status: 200, data: {...}, message: '...'}
                return {
                    success: true,
                    message: result.message,
                    data: result.data, // 这里包含了GitHub用户信息
                    status: result.status
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    message: result.message
                };
            }
            
        } catch (error) {
            console.error('连接测试失败:', error);
            return {
                success: false,
                error: error.message,
                message: '无法连接到云函数后端'
            };
        }
    }
    
    // (在 CloudSyncManager 类中找到 getAllUsersData 方法，修改为：)
    async getAllUsersData() {
        console.log('开始获取所有用户数据...');
        try {
            const url = this.buildUrl(this.apiPaths.GIST || '/gist');
            console.log('获取数据URL:', url);
            const response = await this.sendRequest(url, {
                method: 'GET'
            });
            const result = await response.json();
            console.log('获取数据结果:', result.success ? '成功' : '失败');
            
            if (result.success) {
                // 更新缓存
                if (result.data && result.data.users) {
                    usernameCache.users = Object.keys(result.data.users);
                    usernameCache.lastUpdated = new Date().toISOString();
                    localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
                }
                
                return {
                    success: true,
                    data: result.data || { users: {}, metadata: { totalUsers: 0, version: '1.0' } },
                    lastUpdated: result.lastUpdated,
                    totalUsers: result.totalUsers || 0,
                    isNew: false
                };
            } else {
                throw new Error(result.error || result.message || '获取数据失败');
            }
        } catch (error) {
            console.error('获取数据失败:', error);
            
            // 返回缓存数据（如果有的话）
            if (usernameCache.users.length > 0) {
                console.log('使用缓存的用户名数据');
                return {
                    success: true,
                    data: {
                        users: usernameCache.users.reduce((acc, username) => {
                            acc[username] = { username };
                            return acc;
                        }, {}),
                        metadata: { totalUsers: usernameCache.users.length }
                    },
                    lastUpdated: usernameCache.lastUpdated,
                    totalUsers: usernameCache.users.length,
                    isNew: false
                };
            }
            
            return {
                success: false,
                error: error.message,
                message: '获取云端数据失败'
            };
        }
    }
    
    // 获取特定用户数据
    async getUserData(username) {
        console.log(`开始获取用户数据: ${username}`);
        
        try {
            if (!username) {
                throw new Error('用户名不能为空');
            }
            
            const url = this.buildUrl(`${this.apiPaths.USER || '/user'}?username=${encodeURIComponent(username)}`);
            console.log('获取用户数据URL:', url);
            
            const response = await this.sendRequest(url, {
                method: 'GET'
            });
            
            const result = await response.json();
            console.log('获取用户数据结果:', result.success ? '成功' : '失败');
            
            if (result.success) {
                return {
                    success: true,
                    data: result.data,
                    exists: result.exists,
                    message: result.message
                };
            } else {
                throw new Error(result.error || result.message || '获取用户数据失败');
            }
            
        } catch (error) {
            console.error('获取用户数据失败:', error);
            return {
                success: false,
                error: error.message,
                message: '获取用户数据失败'
            };
        }
    }
    
    // 更新用户数据到云端
    async updateUserData(username, userData) {
        console.log(`开始更新用户数据到云端: ${username}`);
        
        try {
            if (!username || !userData) {
                throw new Error('用户名和用户数据不能为空');
            }
            
            const url = this.buildUrl(this.apiPaths.USER || '/user');
            console.log('更新数据URL:', url);
            
            const response = await this.sendRequest(url, {
                method: 'POST',
                body: JSON.stringify({
                    username: username,
                    userData: userData
                })
            });
            
            const result = await response.json();
            console.log('更新数据结果:', result.success ? '成功' : '失败');
            
            if (result.success) {
                return {
                    success: true,
                    message: result.message || '数据同步成功',
                    userCount: result.userCount || 0,
                    gistUrl: result.gistUrl,
                    lastUpdated: result.lastUpdated
                };
            } else {
                throw new Error(result.error || result.message || '更新数据失败');
            }
            
        } catch (error) {
            console.error('更新数据失败:', error);
            return {
                success: false,
                error: error.message,
                message: '同步到云端失败'
            };
        }
    }
}

// 初始化云函数同步管理器
function initCloudSync() {
    console.log('初始化云函数同步管理器...');
    
    try {
        // 验证配置
        if (!CONFIG.CLOUD_BACKEND.URL || CONFIG.CLOUD_BACKEND.URL.includes('你的云函数地址')) {
            console.warn('云函数配置不完整，同步功能不可用');
            
            // 在界面上显示警告
            updateCloudStatus('未配置', 'warning');
            return;
        }
        
        // 创建管理器实例
        cloudSyncManager = new CloudSyncManager();
        console.log('CloudSyncManager创建成功');
        
        // 测试连接
        setTimeout(async () => {
            console.log('开始测试云函数连接...');
            const result = await cloudSyncManager.testConnection();
            
            // 更新云端状态显示
            if (result.success) {
                updateCloudStatus('已连接', 'success');
                console.log('云函数连接测试成功:', result.message);
                
                // 更新同步按钮状态
                const syncBtn = document.getElementById('sync-button');
                if (syncBtn) {
                    syncBtn.innerHTML = '<i class="fas fa-cloud"></i> 同步到云端';
                    syncBtn.title = '点击同步数据到云端';
                    syncBtn.disabled = false;
                }
            } else {
                updateCloudStatus('连接失败', 'error');
                console.warn('云函数连接测试失败:', result.message);
                
                // 更新同步按钮状态
                const syncBtn = document.getElementById('sync-button');
                if (syncBtn) {
                    syncBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 连接失败';
                    syncBtn.title = result.message;
                    syncBtn.disabled = true;
                }
            }
        }, 500);
        
    } catch (error) {
        console.error('初始化云函数同步管理器失败:', error);
        updateCloudStatus('初始化失败', 'error');
    }
}

// ========== 新增函数：获取云端用户名列表 ==========
async function fetchCloudUsernames() {
    if (!cloudSyncManager) {
        console.log('云函数未配置，无法获取云端用户名');
        return [];
    }
    
    try {
        usernameCache.isLoading = true;
        const result = await cloudSyncManager.getAllUsersData();
        usernameCache.isLoading = false;
        
        if (result.success && result.data && result.data.users) {
            const cloudUsers = Object.keys(result.data.users);
            usernameCache.users = cloudUsers;
            usernameCache.lastUpdated = new Date().toISOString();
            
            // 保存到localStorage
            localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
            console.log(`缓存了 ${cloudUsers.length} 个云端用户名`);
            return cloudUsers;
        }
    } catch (error) {
        console.error('获取云端用户名失败:', error);
        usernameCache.isLoading = false;
    }
    return usernameCache.users; // 返回缓存结果
}

// ========== 新增函数：定期刷新用户名缓存 ==========
function setupUsernameCacheRefresh() {
    // 从localStorage加载缓存
    const cachedData = localStorage.getItem('pes_username_cache');
    if (cachedData) {
        try {
            usernameCache = JSON.parse(cachedData);
            console.log('加载了用户名缓存，最后更新:', usernameCache.lastUpdated);
        } catch (e) {
            console.error('加载用户名缓存失败:', e);
        }
    }
    
    // 立即刷新一次
    refreshUsernameCache();
    
    // 设置每2小时（7200000ms）刷新一次
    setInterval(refreshUsernameCache, 7200000);
    
    // 页面可见时再刷新一次
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshUsernameCache();
        }
    });
}

// ========== 新增函数：刷新用户名缓存 ==========
async function refreshUsernameCache() {
    if (usernameCache.isLoading) return;
    
    console.log('刷新用户名缓存...');
    await fetchCloudUsernames();
}

// ========== 新增函数：检查用户名是否可用 ==========
async function isUsernameAvailable(username) {
    // 检查本地已注册用户
    const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
    if (usersData.users.includes(username)) {
        console.log('用户名在本地已存在');
        return { available: false, source: 'local' };
    }
    
    // 检查云端用户名（使用缓存）
    if (!usernameCache.isLoading && usernameCache.users.includes(username)) {
        console.log('用户名在云端缓存中已存在');
        return { available: false, source: 'cloud' };
    }
    
    // 如果缓存过期（超过24小时），强制刷新
    const lastUpdated = usernameCache.lastUpdated ? new Date(usernameCache.lastUpdated) : null;
    const now = new Date();
    if (!lastUpdated || (now - lastUpdated) > 86400000) {
        console.log('缓存过期，强制刷新');
        await fetchCloudUsernames();
    }
    
    // 重新检查（使用最新缓存）
    if (usernameCache.users.includes(username)) {
        console.log('用户名在云端已存在');
        return { available: false, source: 'cloud' };
    }
    
    return { available: true, source: 'none' };
}

// 更新云端状态显示
function updateCloudStatus(status, type = 'info') {
    console.log('更新云端状态:', status, type);
    
    // 更新登录界面的状态显示
    const cloudStatusText = document.getElementById('cloud-status-text');
    if (cloudStatusText) {
        cloudStatusText.textContent = status;
        
        // 根据类型设置颜色
        const container = document.getElementById('cloud-status-container');
        if (container) {
            container.className = 'stat-item';
            if (type === 'success') container.classList.add('status-success');
            if (type === 'error') container.classList.add('status-error');
            if (type === 'warning') container.classList.add('status-warning');
        }
    }
    
    // 更新注册界面的状态显示
    const registerStatusText = document.getElementById('register-cloud-status-text');
    if (registerStatusText) {
        registerStatusText.textContent = status;
        
        const registerContainer = document.getElementById('register-cloud-status');
        if (registerContainer) {
            registerContainer.classList.remove('hidden');
            registerContainer.className = 'cloud-status-hint';
            if (type === 'success') registerContainer.classList.add('status-success');
            if (type === 'error') registerContainer.classList.add('status-error');
            if (type === 'warning') registerContainer.classList.add('status-warning');
        }
    }
    
    // 更新主界面的状态显示
    const mainStatusText = document.getElementById('cloud-status-text');
    if (mainStatusText) {
        mainStatusText.textContent = status;
        
        const mainContainer = document.getElementById('cloud-status');
        if (mainContainer) {
            mainContainer.className = 'cloud-status-indicator';
            if (type === 'success') mainContainer.classList.add('connected');
            if (type === 'error') mainContainer.classList.add('disconnected');
            if (type === 'warning') mainContainer.classList.add('warning');
        }
    }
}

// 初始化
// ========== 修改 DOMContentLoaded 事件监听器 ==========
document.addEventListener('DOMContentLoaded', function() {
    // 检查隐私协议
    const privacyAgreed = localStorage.getItem(CONFIG.PRIVACY_AGREED);
    if (!privacyAgreed) {
        document.getElementById('privacy-agreement').classList.add('active');
    } else {
        // 隐私协议已同意，继续初始化
        continueInitialization();
    }
    
    // 备注字符计数
    const noteTextarea = document.getElementById('daily-note');
    if (noteTextarea) {
        noteTextarea.addEventListener('input', function() {
            const count = this.value.length;
            document.getElementById('note-chars').textContent = count;
        });
    }
    
    // 初始化云函数同步
    initCloudSync();
    
    // 加载用户统计数据
    updateUserStats();
    
    // 键盘快捷键
    document.addEventListener('keydown', function(event) {
        // F1 打开帮助
        if (event.key === 'F1') {
            event.preventDefault();
            showHelp();
        }
        // Ctrl+S 保存数据
        if (event.ctrlKey && event.key === 's') {
            event.preventDefault();
            if (currentUser) {
                saveData();
            }
        }
        // Ctrl+Y 导入昨日数据
        if (event.ctrlKey && event.key === 'y') {
            event.preventDefault();
            if (currentUser) {
                copyYesterday();
            }
        }
        // Ctrl+T 跳转到今天
        if (event.ctrlKey && event.key === 't') {
            event.preventDefault();
            setToday();
        }
        // 左右箭头切换日期
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            changeDate(-1);
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            changeDate(1);
        }
    });
    // ========== 添加样式 ==========
    const style = document.createElement('style');
    style.textContent = `
    /* 用户名冲突对话框样式 */
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .modal-content {
        background: white;
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
    
    .modal-header {
        padding: 15px 20px;
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .modal-header h2 {
        margin: 0;
        color: #333;
        font-size: 1.4rem;
    }
    
    .close-btn {
        background: none;
        border: none;
        font-size: 1.2rem;
        cursor: pointer;
        color: #666;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.3s;
    }
    
    .close-btn:hover {
        background: #f0f0f0;
        color: #333;
    }
    
    .modal-body {
        padding: 20px;
    }
    
    .modal-footer {
        padding: 15px 20px;
        border-top: 1px solid #eee;
        text-align: right;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }
    
    .conflict-content {
        color: #333;
    }
    
    .conflict-content p {
        margin: 10px 0;
        line-height: 1.5;
    }
    
    .conflict-group {
        margin: 20px 0;
    }
    
    #username-check-status {
        margin-top: 5px;
        font-size: 14px;
        min-height: 20px;
    }
    
    .input-status.valid {
        color: #28a745;
    }
    
    .input-status.invalid {
        color: #dc3545;
    }
    
    .input-status.checking {
        color: #17a2b8;
    }
    
    .suggestions-container {
        margin-top: 20px;
        padding-top: 15px;
        border-top: 1px solid #eee;
    }
    
    .suggestions-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 10px;
        margin-top: 10px;
    }
    
    .suggestion-item {
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
    }
    
    .suggestion-item:hover {
        background: #f0f8ff;
        border-color: #007bff;
    }
    
    /* 响应式调整 */
    @media (max-width: 600px) {
        .modal-content {
            width: 95%;
            margin: 10px;
        }
        
        .suggestions-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }
    `;
    document.head.appendChild(style);
});

// 隐私协议处理
function agreeTerms() {
    const agreeChecked = document.getElementById('agree-terms').checked;
    if (!agreeChecked) {
        alert('请先阅读并同意隐私协议');
        return;
    }
    
    localStorage.setItem(CONFIG.PRIVACY_AGREED, 'true');
    document.getElementById('privacy-agreement').classList.remove('active');
    continueInitialization();
}

function disagreeTerms() {
    alert('您必须同意隐私协议才能使用本工具');
    window.location.href = 'about:blank';
}

// 初始化用户数据结构
function initializeUserDataStructure() {
    // 确保用户列表数据结构正确
    const usersData = JSON.parse(localStorage.getItem('pes_users') || '{}');
    if (!usersData.users || !Array.isArray(usersData.users)) {
        usersData.users = [];
        usersData.lastUpdated = new Date().toISOString();
        localStorage.setItem('pes_users', JSON.stringify(usersData));
    }
    
    // 修复所有现有用户的数据结构
    usersData.users.forEach(username => {
        const userDataStr = localStorage.getItem(`pes_user_${username}`);
        if (userDataStr) {
            try {
                const userData = JSON.parse(userDataStr);
                ensureUserDataStructure(userData);
                localStorage.setItem(`pes_user_${username}`, JSON.stringify(userData));
            } catch (e) {
                console.error(`修复用户 ${username} 的数据时出错:`, e);
            }
        }
    });
}

function continueInitialization() {
    // 设置缓存刷新
    setupUsernameCacheRefresh();
    
    // 设置今天日期
    document.getElementById('current-date').value = currentDate;
    // 显示登录界面
    showLogin();
    // 如果之前有登录信息，尝试自动登录
    const savedUser = localStorage.getItem('pes_current_user');
    if (savedUser) {
        document.getElementById('username').value = savedUser;
    }
    // 初始化日历
    generateCalendar();
}

// 更新用户统计数据
async function updateUserStats() {
    try {
        // 获取本地用户
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        const localUserCount = usersData.users.length;
        
        // 获取云端用户（如果配置了）
        let cloudUserCount = 0;
        let activeTodayCount = 0;
        
        if (cloudSyncManager) {
            const result = await cloudSyncManager.getAllUsersData();
            if (result.success) {
                cloudUserCount = result.totalUsers || Object.keys(result.data.users || {}).length;
                
                // 计算今日活跃用户
                const today = new Date().toDateString();
                const users = result.data.users || {};
                activeTodayCount = Object.values(users).filter(user => {
                    const lastLogin = new Date(user.lastLogin || 0).toDateString();
                    return lastLogin === today;
                }).length;
            }
        }
        
        // 更新显示
        document.getElementById('total-users-count').textContent = Math.max(localUserCount, cloudUserCount);
        document.getElementById('synced-users-count').textContent = cloudUserCount;
        document.getElementById('active-today-count').textContent = activeTodayCount;
        document.getElementById('current-user-count').textContent = localUserCount;
        
    } catch (error) {
        console.error('更新用户统计失败:', error);
    }
}

// 显示登录界面
function showLogin() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('register-section').classList.add('hidden');
    document.getElementById('main-section').classList.add('hidden');
}

// 显示注册界面
function showRegister() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('register-section').classList.remove('hidden');
    document.getElementById('main-section').classList.add('hidden');
    
    // 更新当前用户数
    updateUserStats();
}

// 显示主界面
function showMain() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('register-section').classList.add('hidden');
    document.getElementById('main-section').classList.remove('hidden');
}

// 用户登录
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!username || !password) {
        alert('请输入用户名和密码！');
        return;
    }
    
    if (!/^\d{6}$/.test(password)) {
        alert('密码必须是6位数字！');
        return;
    }
    
    try {
        // 从localStorage加载用户数据
        const userDataStr = localStorage.getItem(`pes_user_${username}`);
        
        if (!userDataStr) {
            throw new Error('用户不存在！');
        }
        
        const storedData = JSON.parse(userDataStr);
        
        // 验证密码
        if (storedData.password !== password) {
            throw new Error('密码错误！');
        }
        
        // 设置当前用户
        currentUser = username;
        userData = storedData;
        
        // 验证并修复用户数据结构
        userData = validateAndFixUserData(username, userData);

        // 确保用户数据结构完整
        ensureUserDataStructure(userData);
        
        // 更新最后登录时间
        userData.lastLogin = new Date().toISOString();
        localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
        
        // 保存登录信息到本地存储
        localStorage.setItem('pes_current_user', username);
        
        // 显示用户信息
        document.getElementById('current-user').textContent = `用户: ${username}`;
        
        // 更新用户计数
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        document.getElementById('user-count').textContent = `${usersData.users.length}`;
        
        // 显示主界面
        showMain();
        
        // 加载今天的数据
        loadDateData();
        
        // 更新统计
        updateStats();
        
        // 更新同步状态
        updateSyncStatus();
        
        // 更新用户统计数据
        updateUserStats();
        
        // 检查 syncInfo 是否存在，不存在则初始化
        if (!userData.syncInfo) {
            userData.syncInfo = {
                storageMode: 'local',
                lastSyncDate: '',
                syncCountToday: 0
            };
            localStorage.setItem(`pes_user_${username}`, JSON.stringify(userData));
        }
        
        // 尝试从云端加载用户数据（如果开启了云同步）
        if (userData.syncInfo && userData.syncInfo.storageMode === 'cloud' && cloudSyncManager) {
            try {
                const cloudResult = await cloudSyncManager.getUserData(username);
                if (cloudResult.success && cloudResult.data) {
                    // 合并云端数据（这里简单处理，实际可能需要更复杂的合并策略）
                    console.log('发现云端数据，准备合并...');
                    // 可以在这里实现数据合并逻辑
                }
            } catch (error) {
                console.log('从云端加载数据失败，继续使用本地数据:', error.message);
            }
        }
        
    } catch (error) {
        alert('登录失败：' + error.message);
    }
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const confirm = document.getElementById('reg-confirm').value.trim();
    const storageMode = document.querySelector('input[name="storage"]:checked').value;
    
    if (!username || !password || !confirm) {
        alert('请填写所有字段！');
        return;
    }
    
    // 用户名验证
    if (!/^[a-zA-Z0-9_]{3,15}$/.test(username)) {
        alert('用户名需3-15个字符，只能包含字母、数字和下划线！');
        return;
    }
    if (password !== confirm) {
        alert('两次输入的密码不一致！');
        return;
    }
    if (!/^\d{6}$/.test(password)) {
        alert('密码必须是6位数字！');
        return;
    }
    
    // 显示加载状态
    const registerBtn = document.querySelector('#register-section button');
    const originalBtnText = registerBtn.innerHTML;
    registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 检查用户名...';
    registerBtn.disabled = true;
    
    try {
        // 检查用户名是否可用
        const checkResult = await isUsernameAvailable(username);
        
        if (!checkResult.available) {
            if (checkResult.source === 'cloud') {
                // 仅当用户名在云端已被占用时，允许更改用户名
                showUsernameConflictDialog(username);
                return;
            } else {
                throw new Error('本设备上已存在该用户名');
            }
        }
        
        // 检查用户数量限制
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        if (usersData.users.length >= CONFIG.MAX_USERS) {
            throw new Error(`用户数量已达上限 ${CONFIG.MAX_USERS} 人！`);
        }
        
        // 创建新用户数据
        const userRecord = {
            username: username,
            password: password,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            syncInfo: {
                storageMode: storageMode,
                lastSyncDate: '',
                syncCountToday: 0
            },
            records: {}
        };
        
        // 保存用户数据到localStorage
        localStorage.setItem(`pes_user_${username}`, JSON.stringify(userRecord));
        
        // 更新用户列表
        usersData.users.push(username);
        usersData.lastUpdated = new Date().toISOString();
        localStorage.setItem('pes_users', JSON.stringify(usersData));
        
        // 更新用户名缓存
        if (!usernameCache.users.includes(username)) {
            usernameCache.users.push(username);
            usernameCache.lastUpdated = new Date().toISOString();
            localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
        }
        
        alert('注册成功！请登录。');
        showLogin();
        document.getElementById('username').value = username;
        document.getElementById('password').value = password;
        
        // 更新用户统计数据
        updateUserStats();
    } catch (error) {
        alert('注册失败：' + error.message);
    } finally {
        // 恢复按钮状态
        registerBtn.innerHTML = originalBtnText;
        registerBtn.disabled = false;
    }
}

// ========== 新增函数：显示用户名冲突对话框 ==========
function showUsernameConflictDialog(originalUsername) {
    // 创建模态框
    const modal = document.createElement('div');
    modal.id = 'username-conflict-modal';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2><i class="fas fa-exclamation-triangle"></i> 用户名已被占用</h2>
                <button class="close-btn" onclick="closeConflictModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="conflict-content">
                    <p>抱歉，用户名 "<strong>${originalUsername}</strong>" 已在云端被其他用户使用。</p>
                    <p>为避免数据冲突，您可以：</p>
                    <ol>
                        <li>修改为一个新用户名（推荐）</li>
                        <li>使用以下建议的用户名</li>
                    </ol>
                    
                    <div class="form-group conflict-group">
                        <label for="new-username">新用户名</label>
                        <input type="text" id="new-username" placeholder="输入新用户名" value="${originalUsername}_new">
                        <div class="input-hint">3-15个字符，仅限字母、数字和下划线</div>
                        <div id="username-check-status" class="input-status"></div>
                    </div>
                    
                    <div class="suggestions-container">
                        <p><strong>建议用户名：</strong></p>
                        <div id="suggestions-list" class="suggestions-grid">
                            <!-- 建议会在这里动态生成 -->
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="closeConflictModal()" class="btn-secondary">取消</button>
                <button onclick="confirmNewUsername('${originalUsername}')" id="confirm-username-btn" class="btn-primary">
                    确认新用户名
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 添加事件监听
    document.getElementById('new-username').addEventListener('input', function() {
        validateNewUsername(this.value);
    });
    
    // 生成建议用户名
    generateUsernameSuggestions(originalUsername);
}

// ========== 新增函数：生成用户名建议 ==========
function generateUsernameSuggestions(baseUsername) {
    const suggestions = [];
    const today = new Date();
    const year = today.getFullYear().toString().slice(2);
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const randomNum = Math.floor(100 + Math.random() * 900);
    
    // 建议组合
    const patterns = [
        `${baseUsername}_${year}${month}${day}`,
        `${baseUsername}_player`,
        `${baseUsername}${randomNum}`,
        `${baseUsername}_user`,
        `${baseUsername}_${Math.floor(Math.random() * 1000)}`
    ];
    
    // 限制建议数量
    const suggestionsList = document.getElementById('suggestions-list');
    suggestionsList.innerHTML = '';
    
    patterns.forEach(pattern => {
        const cleanName = pattern.replace(/[^a-zA-Z0-9_]/g, '');
        if (cleanName.length >= 3 && cleanName.length <= 15) {
            suggestions.push(cleanName);
            
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'suggestion-item';
            suggestionItem.textContent = cleanName;
            suggestionItem.onclick = function() {
                document.getElementById('new-username').value = cleanName;
                validateNewUsername(cleanName);
            };
            suggestionsList.appendChild(suggestionItem);
        }
    });
}

// ========== 新增函数：验证新用户名 ==========
async function validateNewUsername(newUsername) {
    const statusEl = document.getElementById('username-check-status');
    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 检查中...';
    statusEl.className = 'input-status checking';
    
    if (!/^[a-zA-Z0-9_]{3,15}$/.test(newUsername)) {
        statusEl.innerHTML = '用户名格式不正确';
        statusEl.className = 'input-status invalid';
        document.getElementById('confirm-username-btn').disabled = true;
        return;
    }
    
    const checkResult = await isUsernameAvailable(newUsername);
    if (!checkResult.available) {
        statusEl.innerHTML = '该用户名已被占用';
        statusEl.className = 'input-status invalid';
        document.getElementById('confirm-username-btn').disabled = true;
    } else {
        statusEl.innerHTML = '✓ 用户名可用';
        statusEl.className = 'input-status valid';
        document.getElementById('confirm-username-btn').disabled = false;
    }
}

// ========== 新增函数：确认新用户名 ==========
async function confirmNewUsername(originalUsername) {
    const newUsername = document.getElementById('new-username').value.trim();
    const statusEl = document.getElementById('username-check-status');
    
    if (!/^[a-zA-Z0-9_]{3,15}$/.test(newUsername)) {
        alert('新用户名格式不正确！');
        return;
    }
    
    // 再次验证
    const checkResult = await isUsernameAvailable(newUsername);
    if (!checkResult.available) {
        alert('新用户名已被占用，请选择其他名称！');
        return;
    }
    
    // 获取原表单值
    const password = document.getElementById('reg-password').value.trim();
    const confirm = document.getElementById('reg-confirm').value.trim();
    const storageMode = document.querySelector('input[name="storage"]:checked').value;
    
    // 创建新用户
    try {
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        
        if (usersData.users.length >= CONFIG.MAX_USERS) {
            throw new Error(`用户数量已达上限 ${CONFIG.MAX_USERS} 人！`);
        }
        
        const userRecord = {
            username: newUsername,
            password: password,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            syncInfo: {
                storageMode: storageMode,
                lastSyncDate: '',
                syncCountToday: 0
            },
            records: {}
        };
        
        localStorage.setItem(`pes_user_${newUsername}`, JSON.stringify(userRecord));
        
        usersData.users.push(newUsername);
        localStorage.setItem('pes_users', JSON.stringify(usersData));
        
        // 更新用户名缓存
        if (!usernameCache.users.includes(newUsername)) {
            usernameCache.users.push(newUsername);
            usernameCache.lastUpdated = new Date().toISOString();
            localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
        }
        
        closeConflictModal();
        alert(`用户名已更改为 "${newUsername}"，注册成功！`);
        showLogin();
        document.getElementById('username').value = newUsername;
        document.getElementById('password').value = password;
        
        // 更新用户统计数据
        updateUserStats();
    } catch (error) {
        alert('注册失败：' + error.message);
    }
}

// ========== 新增函数：关闭冲突模态框 ==========
function closeConflictModal() {
    const modal = document.getElementById('username-conflict-modal');
    if (modal) {
        modal.remove();
    }
}

// 退出登录
function logout() {
    currentUser = null;
    userData = {
        username: '',
        password: '',
        createdAt: '',
        lastLogin: '',
        syncInfo: {
            lastSyncDate: '',
            syncCountToday: 0,
            storageMode: 'local'
        },
        records: {}
    };
    localStorage.removeItem('pes_current_user');
    showLogin();
    
    // 更新用户统计数据
    updateUserStats();
}

// 确保用户数据结构完整
function ensureUserDataStructure(userData) {
    // 确保 syncInfo 对象存在
    if (!userData.syncInfo) {
        userData.syncInfo = {
            storageMode: 'local',  // 默认使用本地存储
            lastSyncDate: '',
            syncCountToday: 0
        };
    }
    
    // 确保 records 对象存在
    if (!userData.records) {
        userData.records = {};
    }
    
    // 确保 createdAt 存在
    if (!userData.createdAt) {
        userData.createdAt = new Date().toISOString();
    }
    
    return userData;
}

// 获取昨日数据
function getYesterdayData(todayDate) {
    const today = new Date(todayDate);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // 查找昨天的记录
    if (userData.records && userData.records[yesterdayStr]) {
        return userData.records[yesterdayStr];
    }
    
    // 如果没有昨天的记录，返回空数据
    return {
        gold: 0,
        heart_points: 0,
        highlight_coupons: 0,
        new_highlight: 0,
        return_highlight: 0,
        exit_highlight: 0,
        highlight_coins: 0
    };
}

// 计算每日盈亏
function calculateDailyProfitLoss(date) {
    const todayData = userData.records[date];
    if (!todayData) return null;
    
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const yesterdayData = userData.records[yesterdayStr] || {
        gold: 0,
        heart_points: 0,
        highlight_coupons: 0,
        new_highlight: 0,
        return_highlight: 0,
        exit_highlight: 0,
        highlight_coins: 0
    };
    
    return {
        gold: todayData.gold - yesterdayData.gold,
        heart_points: todayData.heart_points - yesterdayData.heart_points,
        highlight_coupons: todayData.highlight_coupons - yesterdayData.highlight_coupons,
        new_highlight: todayData.new_highlight - yesterdayData.new_highlight,
        return_highlight: todayData.return_highlight - yesterdayData.return_highlight,
        exit_highlight: todayData.exit_highlight - yesterdayData.exit_highlight,
        highlight_coins: todayData.highlight_coins - yesterdayData.highlight_coins
    };
}

// 加载指定日期的数据
function loadDateData() {
    const date = document.getElementById('current-date').value;
    currentDate = date;
    
    // 查找当天的记录
    if (userData.records && userData.records[date]) {
        const record = userData.records[date];
        document.getElementById('gold').value = record.gold || 0;
        document.getElementById('heart-points').value = record.heart_points || 0;
        document.getElementById('highlight-coupons').value = record.highlight_coupons || 0;
        document.getElementById('new-highlight').value = record.new_highlight || 0;
        document.getElementById('return-highlight').value = record.return_highlight || 0;
        document.getElementById('exit-highlight').value = record.exit_highlight || 0;
        document.getElementById('highlight-coins').value = record.highlight_coins || 0;
        document.getElementById('daily-note').value = record.note || '';
        document.getElementById('note-chars').textContent = (record.note || '').length;
    } else {
        // 没有记录，清空表单
        resetForm();
    }
    
    // 更新日历显示
    generateCalendar();
}

// 保存数据
async function saveData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    const date = document.getElementById('current-date').value;
    const note = document.getElementById('daily-note').value.trim();
    
    const record = {
        gold: parseInt(document.getElementById('gold').value) || 0,
        heart_points: parseInt(document.getElementById('heart-points').value) || 0,
        highlight_coupons: parseInt(document.getElementById('highlight-coupons').value) || 0,
        new_highlight: parseInt(document.getElementById('new-highlight').value) || 0,
        return_highlight: parseInt(document.getElementById('return-highlight').value) || 0,
        exit_highlight: parseInt(document.getElementById('exit-highlight').value) || 0,
        highlight_coins: parseInt(document.getElementById('highlight-coins').value) || 0,
        note: note,
        updatedAt: new Date().toISOString()
    };
    
    // 如果是新记录，添加创建时间
    if (!userData.records || !userData.records[date]) {
        record.createdAt = new Date().toISOString();
    } else {
        record.createdAt = userData.records[date].createdAt || new Date().toISOString();
    }
    
    // 验证数据
    const yesterdayData = getYesterdayData(date);
    let hasWarning = false;
    let warningMessage = '警告：以下资源总量小于昨日：\n';
    
    const resourceNames = {
        gold: '金币',
        heart_points: '心仪积分',
        highlight_coupons: '高光券',
        new_highlight: '新高光球员',
        return_highlight: '返场高光',
        exit_highlight: '退场高光',
        highlight_coins: '高光币'
    };
    
    for (const [key, value] of Object.entries(record)) {
        if (['note', 'createdAt', 'updatedAt'].includes(key)) continue;
        
        if (value < yesterdayData[key]) {
            hasWarning = true;
            warningMessage += `• ${resourceNames[key]}: ${value} < ${yesterdayData[key]}\n`;
        }
    }
    
    if (hasWarning && !confirm(warningMessage + '\n确定要保存吗？')) {
        return;
    }
    
    // 保存到用户数据
    if (!userData.records) {
        userData.records = {};
    }
    userData.records[date] = record;
    
    // 保存到localStorage
    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
    
    // 更新数据来源标识
    updateDataSourceIndicator('local');
    
    // 更新统计
    updateStats();
    
    // 更新日历显示
    generateCalendar();
    
    alert('数据保存成功！' + (note ? `\n备注："${note.substring(0, 30)}${note.length > 30 ? '...' : ''}"` : ''));
}

// 获取资源中文名
function getResourceChineseName(englishName) {
    const nameMap = {
        'gold': '金币',
        'heart_points': '心仪积分',
        'highlight_coupons': '高光券',
        'new_highlight': '新高光球员',
        'return_highlight': '返场高光',
        'exit_highlight': '退场高光',
        'highlight_coins': '高光币'
    };
    return nameMap[englishName] || englishName;
}

// 重置表单
function resetForm() {
    document.getElementById('gold').value = 0;
    document.getElementById('heart-points').value = 0;
    document.getElementById('highlight-coupons').value = 0;
    document.getElementById('new-highlight').value = 0;
    document.getElementById('return-highlight').value = 0;
    document.getElementById('exit-highlight').value = 0;
    document.getElementById('highlight-coins').value = 0;
    document.getElementById('daily-note').value = '';
    document.getElementById('note-chars').textContent = 0;
}

// 复制昨日数据
async function copyYesterday() {
    const today = new Date(currentDate);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // 查找昨天的记录
    if (userData.records && userData.records[yesterdayStr]) {
        const yesterdayRecord = userData.records[yesterdayStr];
        document.getElementById('gold').value = yesterdayRecord.gold || 0;
        document.getElementById('heart-points').value = yesterdayRecord.heart_points || 0;
        document.getElementById('highlight-coupons').value = yesterdayRecord.highlight_coupons || 0;
        document.getElementById('new-highlight').value = yesterdayRecord.new_highlight || 0;
        document.getElementById('return-highlight').value = yesterdayRecord.return_highlight || 0;
        document.getElementById('exit-highlight').value = yesterdayRecord.exit_highlight || 0;
        document.getElementById('highlight-coins').value = yesterdayRecord.highlight_coins || 0;
        document.getElementById('daily-note').value = yesterdayRecord.note || '';
        document.getElementById('note-chars').textContent = (yesterdayRecord.note || '').length;
        alert('昨日总量已导入！请修改为今日总量后保存。');
    } else {
        alert('找不到昨日的记录！');
    }
}

// 设置今天日期
function setToday() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('current-date').value = today;
    currentDate = today;
    loadDateData();
}

// 改变日期
function changeDate(days) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + days);
    const newDate = date.toISOString().split('T')[0];
    document.getElementById('current-date').value = newDate;
    currentDate = newDate;
    loadDateData();
}

// 生成日历
function generateCalendar() {
    const calendarEl = document.getElementById('calendar');
    const summaryEl = document.getElementById('calendar-summary');
    
    // 清空日历
    calendarEl.innerHTML = '';
    summaryEl.innerHTML = '';
    
    const today = new Date();
    const current = new Date(currentDate);
    const year = current.getFullYear();
    const month = current.getMonth();
    
    // 获取月份的第一天和最后一天
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // 计算第一天是星期几（0=周日，1=周一，...）
    const firstDayOfWeek = firstDay.getDay();
    
    // 生成日历标题
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', 
                       '七月', '八月', '九月', '十月', '十一月', '十二月'];
    
    // 添加星期标题
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    for (let i = 0; i < 7; i++) {
        const weekdayEl = document.createElement('div');
        weekdayEl.className = 'calendar-day weekday';
        weekdayEl.textContent = weekdays[i];
        calendarEl.appendChild(weekdayEl);
    }
    
    // 添加空白单元格
    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'calendar-day empty';
        calendarEl.appendChild(emptyEl);
    }
    
    // 计算本月总盈亏
    let totalGoldChange = 0;
    let totalHeartChange = 0;
    let totalCouponsChange = 0;
    let totalCoinsChange = 0;
    let totalNewHighlightChange = 0;
    let totalReturnHighlightChange = 0;
    let totalExitHighlightChange = 0;
    let hasDataDays = 0;
    let hasNoteDays = 0;
    
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        
        // 检查是否是今天
        if (date === today.toISOString().split('T')[0]) {
            dayEl.classList.add('today');
        }
        
        // 检查是否有数据
        if (userData.records && userData.records[date]) {
            dayEl.classList.add('has-data');
            
            // 检查是否有备注
            const record = userData.records[date];
            if (record.note && record.note.trim()) {
                const noteIndicator = document.createElement('div');
                noteIndicator.className = 'note-indicator';
                noteIndicator.innerHTML = '<i class="fas fa-sticky-note"></i>';
                dayEl.appendChild(noteIndicator);
                hasNoteDays++;
            }
            
            // 计算当日盈亏
            const profitLoss = calculateDailyProfitLoss(date);
            if (profitLoss) {
                // 计算盈亏
                const goldChange = profitLoss.gold || 0;
                const heartChange = profitLoss.heart_points || 0;
                const couponsChange = profitLoss.highlight_coupons || 0;
                const coinsChange = profitLoss.highlight_coins || 0;
                const newHighlightChange = profitLoss.new_highlight || 0;
                const returnHighlightChange = profitLoss.return_highlight || 0;
                const exitHighlightChange = profitLoss.exit_highlight || 0;
                
                // 累加到本月总盈亏
                totalGoldChange += goldChange;
                totalHeartChange += heartChange;
                totalCouponsChange += couponsChange;
                totalCoinsChange += coinsChange;
                totalNewHighlightChange += newHighlightChange;
                totalReturnHighlightChange += returnHighlightChange;
                totalExitHighlightChange += exitHighlightChange;
                hasDataDays++;
                
                // 添加数据提示（显示金币盈亏）
                const dataEl = document.createElement('div');
                dataEl.className = 'day-data';
                
                let goldSymbol = '';
                let goldClass = '';
                if (goldChange > 0) {
                    goldSymbol = `+${goldChange}`;
                    goldClass = 'profit';
                } else if (goldChange < 0) {
                    goldSymbol = `${goldChange}`;
                    goldClass = 'loss';
                } else {
                    goldSymbol = `0`;
                }
                
                dataEl.innerHTML = `<span class="${goldClass}">💰${goldSymbol}</span>`;
                dayEl.appendChild(dataEl);
                
                // 添加详情提示
                const detailText = `日期: ${date}\n` +
                                 `金币: ${goldSymbol}\n` +
                                 `心仪积分: ${heartChange >= 0 ? '+' : ''}${heartChange}\n` +
                                 `高光券: ${couponsChange >= 0 ? '+' : ''}${couponsChange}\n` +
                                 `新高光: ${newHighlightChange >= 0 ? '+' : ''}${newHighlightChange}\n` +
                                 `返场高光: ${returnHighlightChange >= 0 ? '+' : ''}${returnHighlightChange}\n` +
                                 `退场高光: ${exitHighlightChange >= 0 ? '+' : ''}${exitHighlightChange}\n` +
                                 `高光币: ${coinsChange >= 0 ? '+' : ''}${coinsChange}` +
                                 (record.note ? `\n\n备注: ${record.note}` : '');
                
                dayEl.title = detailText;
            }
        }
        
        const dayNumberEl = document.createElement('div');
        dayNumberEl.className = 'day-number';
        dayNumberEl.textContent = day;
        dayEl.appendChild(dayNumberEl);
        
        // 点击日期跳转到该日期
        dayEl.onclick = function() {
            document.getElementById('current-date').value = date;
            currentDate = date;
            loadDateData();
        };
        
        calendarEl.appendChild(dayEl);
    }
    
    // 更新日历摘要
    summaryEl.innerHTML = `
        <h3>${monthNames[month]} ${year} 日报表</h3>
        <div class="summary-stats">
            <p><i class="fas fa-calendar-check"></i> 有数据天数: <strong>${hasDataDays}</strong> 天</p>
            <p><i class="fas fa-sticky-note"></i> 有备注天数: <strong>${hasNoteDays}</strong> 天</p>
            <p><i class="fas fa-coins"></i> 本月金币盈亏: <strong class="${totalGoldChange >= 0 ? 'profit' : 'loss'}">${totalGoldChange >= 0 ? '+' : ''}${totalGoldChange}</strong></p>
            <p><i class="fas fa-heart"></i> 本月心仪积分盈亏: <strong class="${totalHeartChange >= 0 ? 'profit' : 'loss'}">${totalHeartChange >= 0 ? '+' : ''}${totalHeartChange}</strong></p>
            <p><i class="fas fa-ticket-alt"></i> 本月高光券盈亏: <strong class="${totalCouponsChange >= 0 ? 'profit' : 'loss'}">${totalCouponsChange >= 0 ? '+' : ''}${totalCouponsChange}</strong></p>
            <p><i class="fas fa-money-bill-wave"></i> 本月高光币盈亏: <strong class="${totalCoinsChange >= 0 ? 'profit' : 'loss'}">${totalCoinsChange >= 0 ? '+' : ''}${totalCoinsChange}</strong></p>
        </div>
    `;
}

// 更新统计数据
function updateStats() {
    if (!userData.records) {
        userData.records = {};
    }
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // 获取今日数据
    let todayGold = 0;
    let todayHeart = 0;
    let todayCoupons = 0;
    let todayCoins = 0;
    let todayNewHighlight = 0;
    let todayReturnHighlight = 0;
    let todayExitHighlight = 0;
    
    if (userData.records[todayStr]) {
        const todayRecord = userData.records[todayStr];
        todayGold = todayRecord.gold || 0;
        todayHeart = todayRecord.heart_points || 0;
        todayCoupons = todayRecord.highlight_coupons || 0;
        todayCoins = todayRecord.highlight_coins || 0;
        todayNewHighlight = todayRecord.new_highlight || 0;
        todayReturnHighlight = todayRecord.return_highlight || 0;
        todayExitHighlight = todayRecord.exit_highlight || 0;
    }
    
    // 计算本月盈亏
    let monthGoldChange = 0;
    let monthHeartChange = 0;
    let monthCouponsChange = 0;
    let monthCoinsChange = 0;
    let monthNewHighlightChange = 0;
    let monthReturnHighlightChange = 0;
    let monthExitHighlightChange = 0;
    
    for (const [date, record] of Object.entries(userData.records)) {
        const recordDate = new Date(date);
        if (recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear) {
            const profitLoss = calculateDailyProfitLoss(date);
            if (profitLoss) {
                monthGoldChange += profitLoss.gold || 0;
                monthHeartChange += profitLoss.heart_points || 0;
                monthCouponsChange += profitLoss.highlight_coupons || 0;
                monthCoinsChange += profitLoss.highlight_coins || 0;
                monthNewHighlightChange += profitLoss.new_highlight || 0;
                monthReturnHighlightChange += profitLoss.return_highlight || 0;
                monthExitHighlightChange += profitLoss.exit_highlight || 0;
            }
        }
    }
    
    // 更新统计显示
    updateStatCard('total-gold', 'gold-change', todayGold, monthGoldChange, 'fa-coins', '金币');
    updateStatCard('total-heart', 'heart-change', todayHeart, monthHeartChange, 'fa-heart', '心仪积分');
    updateStatCard('total-coupons', 'coupons-change', todayCoupons, monthCouponsChange, 'fa-ticket-alt', '高光券');
    updateStatCard('total-coins', 'coins-change', todayCoins, monthCoinsChange, 'fa-money-bill-wave', '高光币');
    updateStatCard('total-new-highlight', 'new-highlight-change', todayNewHighlight, monthNewHighlightChange, 'fa-user-plus', '新高光球员');
    updateStatCard('total-return-highlight', 'return-highlight-change', todayReturnHighlight, monthReturnHighlightChange, 'fa-redo', '返场高光');
    updateStatCard('total-exit-highlight', 'exit-highlight-change', todayExitHighlight, monthExitHighlightChange, 'fa-user-minus', '退场高光');
}

// 更新统计卡片
function updateStatCard(totalId, changeId, todayValue, monthChange, iconClass, resourceName) {
    // 更新总量
    const totalElement = document.getElementById(totalId);
    if (totalElement) {
        totalElement.textContent = todayValue;
        
        // 移除旧的盈亏显示
        const oldChange = totalElement.nextElementSibling;
        if (oldChange && oldChange.classList.contains('change-value')) {
            oldChange.remove();
        }
        
        // 添加新的盈亏显示
        if (monthChange !== 0) {
            const changeElement = document.createElement('span');
            changeElement.className = `change-value ${monthChange > 0 ? 'positive' : 'negative'}`;
            changeElement.textContent = `${monthChange > 0 ? '+' : ''}${monthChange}`;
            changeElement.title = `本月${resourceName}盈亏`;
            totalElement.parentElement.appendChild(changeElement);
        }
    }
}

// 替换整个 syncToCloud 函数 (大约在900行)
async function syncToCloud() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    if (!cloudSyncManager) {
        alert('云同步功能未配置，请联系管理员！');
        return;
    }
    
    // 检查同步限制（但不依赖存储模式）
    const syncInfo = userData.syncInfo || {};
    const today = new Date().toDateString();
    
    if (syncInfo.lastSyncDate === today && syncInfo.syncCountToday >= CONFIG.SYNC_LIMIT_PER_DAY) {
        alert(`今天已经同步过 ${CONFIG.SYNC_LIMIT_PER_DAY} 次了，请明天再试！`);
        return;
    }
    
    // 显示确认对话框，强调这是手动上传
    const confirmMsg = `🔒 数据同步提示

您即将手动将数据上传到云端，以便在多设备间同步。

${CONFIG.PRIVACY_WARNING}

上传后：
• 您的数据将被存储在管理员的GitHub Gist中
• 管理员可以查看这些数据
• 本操作不影响您的默认存储方式（数据仍保存在本地）

确定要上传数据到云端吗？`;

    if (!confirm(confirmMsg)) {
        return;
    }
    
    // 显示加载状态
    const syncBtn = document.getElementById('sync-button');
    const originalText = syncBtn.innerHTML;
    const originalDisabled = syncBtn.disabled;
    syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传中...';
    syncBtn.disabled = true;
    
    try {
        // 准备要同步的数据
        const syncData = {
            ...userData,
            lastSync: new Date().toISOString()
        };
        
        // 调用云函数API上传数据
        const result = await cloudSyncManager.updateUserData(currentUser, syncData);
        
        if (result.success) {
            // 更新本地同步信息（仅记录同步行为，不改变存储模式）
            if (!userData.syncInfo) {
                userData.syncInfo = {};
            }
            
            // 更新同步次数和日期
            if (syncInfo.lastSyncDate !== today) {
                userData.syncInfo.syncCountToday = 1;
            } else {
                userData.syncInfo.syncCountToday = (syncInfo.syncCountToday || 0) + 1;
            }
            userData.syncInfo.lastSyncDate = today;
            userData.syncInfo.lastSyncTime = new Date().toISOString();
            
            // 保存到本地
            localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
            
            // 更新界面
            updateSyncStatus();
            updateDataSourceIndicator('synced');
            
            alert(`✅ 数据上传成功！
• 总用户数: ${result.userCount}/${CONFIG.MAX_USERS}
• 今日剩余上传次数: ${CONFIG.SYNC_LIMIT_PER_DAY - userData.syncInfo.syncCountToday}
数据已安全上传到云端，您的默认存储方式仍为本地。`);
            
            // 更新用户统计数据
            updateUserStats();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('上传失败:', error);
        alert(`❌ 上传失败: ${error.message}
数据仍然安全地保存在您的本地设备中，请稍后重试。`);
        updateDataSourceIndicator('local');
    } finally {
        // 恢复按钮状态
        syncBtn.innerHTML = originalText;
        syncBtn.disabled = originalDisabled;
    }
}

// 更新同步状态显示
function updateSyncStatus() {
    if (!currentUser) return;
    
    const syncInfo = userData.syncInfo || {};
    const today = new Date().toDateString();
    
    const syncCountElement = document.getElementById('sync-count');
    const syncStatusElement = document.getElementById('sync-status');
    
    if (syncCountElement) {
        syncCountElement.textContent = syncInfo.syncCountToday || 0;
    }
    
    if (syncStatusElement) {
        if (syncInfo.lastSyncDate === today && syncInfo.syncCountToday >= CONFIG.SYNC_LIMIT_PER_DAY) {
            syncStatusElement.className = 'sync-status limit-reached';
            syncStatusElement.title = '今日同步次数已用完';
        } else {
            syncStatusElement.className = 'sync-status';
            syncStatusElement.title = `今日已同步: ${syncInfo.syncCountToday || 0}/${CONFIG.SYNC_LIMIT_PER_DAY}`;
        }
    }
}

// 替换 updateDataSourceIndicator 函数 (大约在1050行)
function updateDataSourceIndicator(source) {
    document.getElementById('data-source-local').classList.add('hidden');
    document.getElementById('data-source-synced').classList.add('hidden');
    document.getElementById('data-source-outdated').classList.add('hidden');
    
    // 所有用户默认显示本地存储
    if (source === 'local') {
        document.getElementById('data-source-local').classList.remove('hidden');
    } 
    // 如果是今天同步的，显示已同步
    else if (source === 'synced') {
        const syncInfo = userData.syncInfo || {};
        const today = new Date().toDateString();
        if (syncInfo.lastSyncDate === today) {
            document.getElementById('data-source-synced').classList.remove('hidden');
        } else {
            document.getElementById('data-source-outdated').classList.remove('hidden');
        }
    }
    // 如果是过期的同步状态，显示未同步
    else if (source === 'outdated') {
        document.getElementById('data-source-outdated').classList.remove('hidden');
    }
}

// 导出数据（用于备份）
function exportData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    const dataStr = JSON.stringify(userData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `pes_data_${currentUser}_${currentDate}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    alert('数据导出成功！文件名：' + exportFileDefaultName);
}

// 导入数据（从备份恢复）
function importData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    if (!confirm('警告：导入数据会覆盖当前所有记录！\n\n请确认：\n1. 您已经备份了当前数据\n2. 导入的是正确的备份文件\n\n确定要继续吗？')) {
        return;
    }
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                
                // 验证数据格式
                if (!importedData.username || !importedData.records) {
                    throw new Error('文件格式错误：不是有效的备份文件');
                }
                
                // 验证用户名匹配
                if (importedData.username !== currentUser) {
                    if (!confirm(`备份文件用户名为：${importedData.username}\n当前登录用户为：${currentUser}\n\n用户名不匹配！确定要强制导入吗？`)) {
                        return;
                    }
                }
                
                // 显示导入详情
                const recordCount = Object.keys(importedData.records || {}).length;
                const dates = Object.keys(importedData.records || {}).sort();
                const firstDate = dates[0] || '无';
                const lastDate = dates[dates.length - 1] || '无';
                
                const confirmMsg = `即将导入：\n` +
                                 `• 用户：${importedData.username}\n` +
                                 `• 记录数：${recordCount} 条\n` +
                                 `• 时间范围：${firstDate} 至 ${lastDate}\n\n` +
                                 `导入后将完全替换当前数据，无法撤销！\n确定要导入吗？`;
                
                if (confirm(confirmMsg)) {
                    userData = importedData;
                    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
                    
                    alert(`数据导入成功！\n已导入 ${recordCount} 条记录。`);
                    
                    // 刷新界面
                    loadDateData();
                    updateStats();
                    generateCalendar();
                    updateSyncStatus();
                    
                    // 显示导入完成提示
                    setTimeout(() => {
                        alert('导入完成！建议您立即导出一次数据作为备份。');
                    }, 500);
                }
                
            } catch (error) {
                alert('导入失败：' + error.message + '\n\n请确保选择的是正确的JSON备份文件。');
            }
        };
        
        reader.readAsText(file);
    };
    
    input.click();
}

// 显示备注历史
function showNoteHistory() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    const historyContent = document.getElementById('note-history-content');
    historyContent.innerHTML = '';
    
    if (!userData.records || Object.keys(userData.records).length === 0) {
        historyContent.innerHTML = '<p style="text-align: center; color: #a0a0a0;">暂无备注记录</p>';
    } else {
        // 获取有备注的记录并按日期倒序排序
        const notes = [];
        for (const [date, record] of Object.entries(userData.records)) {
            if (record.note && record.note.trim()) {
                notes.push({
                    date: date,
                    note: record.note,
                    createdAt: record.createdAt
                });
            }
        }
        
        // 按日期倒序排序
        notes.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        if (notes.length === 0) {
            historyContent.innerHTML = '<p style="text-align: center; color: #a0a0a0;">暂无备注记录</p>';
        } else {
            notes.forEach(item => {
                const noteElement = document.createElement('div');
                noteElement.className = 'note-history-item';
                noteElement.innerHTML = `
                    <div class="note-history-date">
                        <span>${item.date}</span>
                        <small>${item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : ''}</small>
                    </div>
                    <div class="note-history-content">
                        ${item.note.replace(/\n/g, '<br>')}
                    </div>
                `;
                historyContent.appendChild(noteElement);
            });
        }
    }
    
    document.getElementById('note-history-dialog').classList.add('active');
}

function closeNoteHistory() {
    document.getElementById('note-history-dialog').classList.remove('active');
}

// 管理员登录
function openAdmin() {
    const password = prompt('请输入管理员密码：');
    if (password === CONFIG.ADMIN_PASSWORD) {
        window.open('admin.html', '_blank');
    } else {
        alert('密码错误！提示：123456');
    }
}

// 显示帮助
function showHelp() {
    const helpContent = document.querySelector('.help-content .modal-body');
    helpContent.innerHTML = `
        <div class="help-sections">
            <div class="help-section">
                <h3><i class="fas fa-play-circle"></i> 基本使用</h3>
                <ol class="help-list steps">
                    <li><strong>注册账户</strong>：首次使用请注册，用户名唯一，密码为6位数字</li>
                    <li><strong>登录</strong>：使用注册的用户名和密码登录</li>
                    <li><strong>记录数据</strong>：每天结束时填写各项资源的总量</li>
                    <li><strong>保存数据</strong>：点击"保存今日总量"按钮</li>
                    <li><strong>查看统计</strong>：系统自动计算每日盈亏和本月累计</li>
                </ol>
            </div>
            
            <div class="help-section">
                <h3><i class="fas fa-database"></i> 数据管理</h3>
                <h4>导出数据（备份）</h4>
                <ol class="help-list steps">
                    <li>点击右上角<strong>"导出"</strong>按钮（绿色）</li>
                    <li>浏览器会自动下载备份文件：<code>pes_data_用户名_日期.json</code></li>
                    <li>将此文件保存到安全位置</li>
                </ol>
                
                <h4>导入数据（恢复）</h4>
                <ol class="help-list steps">
                    <li>点击右上角<strong>"导入"</strong>按钮（蓝色）</li>
                    <li>选择之前导出的JSON文件</li>
                    <li>系统会提示确认，确认后会覆盖当前数据</li>
                </ol>
                
                // 在 showHelp() 函数中找到云端同步部分，替换为:
                <h4>云端同步</h4>
                <ol class="help-list steps">
                    <li>点击右上角<strong>"同步"</strong>按钮（深绿色）</li>
                    <li>每天限上传1次</li>
                    <li>数据将临时上传到云端，管理员可以访问</li>
                    <li><strong>重要：</strong>您的数据默认保存在本地，上传是手动操作</li>
                    <li><strong>请勿</strong>上传任何敏感或个人信息</li>
                </ol>
                
                <div class="warning">
                    <p><i class="fas fa-exclamation-triangle"></i> <strong>警告：</strong>上传到云端的数据管理员可以看到，请仅上传游戏资源数据。</p>
                </div>
            </div>
            
            <div class="help-section">
                <h3><i class="fas fa-star"></i> 主要功能</h3>
                <ul class="help-list">
                    <li><strong>今日数据录入</strong>：记录每日结束时各项资源的总量</li>
                    <li><strong>导入昨日数据</strong>：一键复制昨天总量，只需修改变化部分</li>
                    <li><strong>备注功能</strong>：可为每天记录添加备注</li>
                    <li><strong>本月日报表</strong>：日历视图显示每日盈亏，点击日期查看详情</li>
                    <li><strong>统计概览</strong>：显示今日总量和本月累计盈亏</li>
                </ul>
            </div>
            
            <div class="help-section">
                <h3><i class="fas fa-keyboard"></i> 快捷键</h3>
                <ul class="help-list">
                    <li><span class="shortcut">F1</span> - 打开帮助</li>
                    <li><span class="shortcut">Ctrl + S</span> - 保存数据</li>
                    <li><span class="shortcut">Ctrl + Y</span> - 导入昨日数据</li>
                    <li><span class="shortcut">Ctrl + T</span> - 跳转到今天</li>
                    <li><span class="shortcut">← →</span> - 切换日期</li>
                </ul>
            </div>
            
            <div class="help-section">
                <h3><i class="fas fa-life-ring"></i> 常见问题</h3>
                
                <h4>Q1: 数据存在哪里？会丢失吗？</h4>
                <p>数据默认存储在您的浏览器本地。如果您清除浏览器数据或更换设备，数据会丢失。请定期使用"导出"功能备份。</p>
                
                <h4>Q2: 如何在不同设备间同步数据？</h4>
                <p>1. 在旧设备上"导出数据"<br>2. 将备份文件传输到新设备<br>3. 在新设备上"导入数据"</p>
                
                <h4>Q3: 密码忘记了怎么办？</h4>
                <p>目前无法找回密码。建议您妥善保管密码。</p>
                
                <h4>Q4: 为什么我的数据显示红色负数？</h4>
                <p>红色表示当日总量比前一日减少。请检查数据是否正确，如果确实减少了，这是正常的。</p>
                
                <h4>Q5: 管理员功能有什么作用？</h4>
                <p>管理员可以查看所有用户数据、删除用户、导出全部数据。密码请询问系统管理员。</p>
                
                <h4>Q6: 云端同步和本地存储有什么区别？</h4>
                <p>云端同步：数据存储在云函数后端的GitHub Gist中，可以在不同设备间同步，但每天有次数限制。<br>
                   本地存储：数据仅存储在您的浏览器中，不会上传到云端，没有同步次数限制。</p>
            </div>
        </div>
    `;
    
    document.getElementById('help-dialog').classList.add('active');
}

function closeHelp() {
    document.getElementById('help-dialog').classList.remove('active');
}

// 隐私信息和关于我们
function showPrivacyInfo() {
    alert('隐私政策：\n\n1. 数据默认存储在浏览器本地\n2. 选择云端同步后，数据将通过云函数存储在GitHub Gist中\n3. 管理员可以看到GitHub上的所有用户数据\n4. 请勿存储任何敏感个人信息\n5. 建议定期导出数据备份');
}

function showAbout() {
    alert('关于实况足球资源记录器：\n\n版本：v2.0（使用云函数后端）\n功能：记录游戏资源、计算盈亏、数据备份和云端同步\n说明：完全免费，仅供学习交流使用\n作者：实况足球爱好者\n更新日期：2024年\n后端架构：腾讯云函数 + GitHub API');
}

// 测试云函数连接
async function testCloudConnection() {
    console.log('=== 手动测试云函数连接 ===');
    
    if (!cloudSyncManager) {
        alert('云函数同步管理器未初始化');
        return;
    }
    
    try {
        // 测试基本连接
        const testResult = await cloudSyncManager.testConnection();
        console.log('连接测试结果:', testResult);
        
        // 显示更详细的信息
        let message = `测试结果:\n\n1. 连接测试: ${testResult.success ? '✅ 成功' : '❌ 失败'}\n   ${testResult.message}`;
        
        if (testResult.success && testResult.data) {
            message += `\n   用户: ${testResult.data.login || '未知'}`;
            message += `\n   ID: ${testResult.data.id || '未知'}`;
        }
        
        // 测试Gist访问
        if (testResult.success) {
            const gistResult = await cloudSyncManager.getAllUsersData();
            console.log('Gist访问结果:', gistResult);
            
            message += `\n\n2. Gist访问: ${gistResult.success ? '✅ 成功' : '❌ 失败'}\n   ${gistResult.message || gistResult.error || '无错误信息'}`;
            
            if (gistResult.success) {
                message += `\n   总用户数: ${gistResult.totalUsers || 0}`;
                message += `\n   最后更新: ${gistResult.lastUpdated ? new Date(gistResult.lastUpdated).toLocaleString('zh-CN') : '未知'}`;
            }
        }
        
        alert(message);
        
    } catch (error) {
        console.error('测试失败:', error);
        alert('测试失败: ' + error.message);
    }
}

// 验证并修复用户数据结构
function validateAndFixUserData(username, userData) {
    // 确保 records 存在
    if (!userData.records) {
        userData.records = {};
    }
    
    // 确保 syncInfo 结构完整
    if (!userData.syncInfo) {
        userData.syncInfo = {
            storageMode: 'local',
            lastSyncDate: '',
            syncCountToday: 0
        };
    } else {
        // 确保 syncInfo 的所有属性都存在
        if (!userData.syncInfo.storageMode) userData.syncInfo.storageMode = 'local';
        if (!userData.syncInfo.lastSyncDate) userData.syncInfo.lastSyncDate = '';
        if (typeof userData.syncInfo.syncCountToday !== 'number') userData.syncInfo.syncCountToday = 0;
    }
    
    // 确保时间戳字段存在
    if (!userData.createdAt) userData.createdAt = new Date().toISOString();
    if (!userData.lastLogin) userData.lastLogin = new Date().toISOString();
    
    // 保存修复后的数据
    localStorage.setItem(`pes_user_${username}`, JSON.stringify(userData));
    return userData;
}

// 修改之前的syncToGitHub函数名为syncToCloud（已经修改）
// 修改之前的syncToGitHub调用为syncToCloud调用（已经修改）
// 修改界面上的相关文本显示
