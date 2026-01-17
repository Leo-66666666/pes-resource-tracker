// 配置验证
setTimeout(() => {
    console.log('=== 配置验证 ===');
    console.log('云函数地址:', CONFIG.CLOUD_BACKEND.URL);
    console.log('最大用户数:', CONFIG.MAX_USERS);
    console.log('=== 验证结束 ===');
}, 100);

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
        storageMode: 'local'
    },
    records: {}
};
let usernameCache = {
    users: [],
    lastUpdated: null,
    isLoading: false,
    lastRefreshed: null
};
let cloudSyncManager = null;

// 云函数同步管理器
class CloudSyncManager {
    constructor() {
        this.baseURL = CONFIG.CLOUD_BACKEND.URL;
        this.apiPaths = CONFIG.CLOUD_BACKEND.API_PATHS;
        
        if (!this.baseURL || this.baseURL.includes('你的云函数地址')) {
            throw new Error('云函数配置不完整');
        }
        
        this.maxRetries = 2;
        this.retryDelay = 1000;
    }
    
    buildUrl(path) {
        return `${this.baseURL}${path}`;
    }
    
    async sendRequest(url, options = {}, retryCount = 0) {
        try {
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
            if (!response.ok) {
                if (response.status >= 500 && retryCount < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    return this.sendRequest(url, options, retryCount + 1);
                }
                
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            }
            return response;
        } catch (error) {
            if (retryCount < this.maxRetries && !error.message.includes('HTTP')) {
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.sendRequest(url, options, retryCount + 1);
            }
            throw error;
        }
    }
    
    async testConnection() {
        try {
            const testUrl = `${this.baseURL}/test`;
            const response = await fetch(testUrl, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const result = await response.json();
            if (result.success) {
                return {
                    success: true,
                    message: result.message,
                    data: result.data
                };
            }
            return {
                success: false,
                error: result.error,
                message: result.message
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: '无法连接到云函数后端'
            };
        }
    }
    
    async getAllUsersData() {
        try {
            const url = this.buildUrl(this.apiPaths.GIST || '/gist');
            const response = await this.sendRequest(url, { method: 'GET' });
            const result = await response.json();
            
            if (result.success) {
                if (result.data && result.data.users) {
                    usernameCache.users = Object.keys(result.data.users);
                    usernameCache.lastUpdated = new Date().toISOString();
                    localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
                }
                return {
                    success: true,
                    data: result.data || { users: {}, metadata: { totalUsers: 0, version: '1.0' } },
                    lastUpdated: result.lastUpdated,
                    totalUsers: result.totalUsers || 0
                };
            }
            throw new Error(result.message || '获取数据失败');
        } catch (error) {
            console.error('获取数据失败:', error);
            
            if (usernameCache.users.length > 0) {
                return {
                    success: true,
                    data: {
                        users: usernameCache.users.reduce((acc, username) => {
                            acc[username] = { username };
                            return acc;
                        }, {}),
                        metadata: { 
                            totalUsers: usernameCache.users.length,
                            lastUpdated: usernameCache.lastUpdated,
                            version: '1.0' 
                        }
                    },
                    lastUpdated: usernameCache.lastUpdated,
                    totalUsers: usernameCache.users.length
                };
            }
            
            return {
                success: false,
                error: error.message,
                message: '获取云端数据失败'
            };
        }
    }
    
    async getUserData(username) {
        try {
            if (!username) throw new Error('用户名不能为空');
            
            const url = this.buildUrl(`${this.apiPaths.USER || '/user'}?username=${encodeURIComponent(username)}`);
            const response = await this.sendRequest(url, { method: 'GET' });
            const result = await response.json();
            
            if (result.success) {
                return {
                    success: true,
                    data: result.data,
                    exists: !!result.data
                };
            }
            throw new Error(result.message || '获取用户数据失败');
        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: '获取用户数据失败'
            };
        }
    }
    
    async updateUserData(username, userData) {
        try {
            if (!username || !userData) throw new Error('用户名和用户数据不能为空');
            
            const url = this.buildUrl(this.apiPaths.USER || '/user');
            const response = await this.sendRequest(url, {
                method: 'POST',
                body: JSON.stringify({
                    username: username,
                    userData: userData
                })
            });
            
            const result = await response.json();
            if (result.success) {
                return {
                    success: true,
                    message: result.message || '数据同步成功',
                    userCount: result.userCount || 0,
                    lastUpdated: result.lastUpdated
                };
            }
            throw new Error(result.message || '更新数据失败');
        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: '同步到云端失败'
            };
        }
    }
}

// 初始化云函数同步
function initCloudSync() {
    try {
        if (!CONFIG.CLOUD_BACKEND.URL || CONFIG.CLOUD_BACKEND.URL.includes('你的云函数地址')) {
            console.warn('云函数配置不完整，同步功能不可用');
            updateCloudStatus('未配置', 'warning');
            return;
        }
        
        cloudSyncManager = new CloudSyncManager();
        updateCloudStatus('检测中', 'info');
        
        // 测试连接
        setTimeout(async () => {
            const result = await cloudSyncManager.testConnection();
            
            if (result.success) {
                updateCloudStatus('已连接', 'success');
                // 成功连接后初始化用户名缓存
                setupUsernameCacheRefresh();
                
                const syncBtn = document.getElementById('sync-button');
                if (syncBtn) {
                    syncBtn.innerHTML = '<i class="fas fa-cloud"></i> 同步到云端';
                    syncBtn.disabled = false;
                }
            } else {
                updateCloudStatus('连接失败', 'error');
                const syncBtn = document.getElementById('sync-button');
                if (syncBtn) {
                    syncBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 连接失败';
                    syncBtn.disabled = true;
                }
            }
        }, 500);
    } catch (error) {
        console.error('初始化云函数同步管理器失败:', error);
        updateCloudStatus('初始化失败', 'error');
    }
}

// 用户名缓存管理
async function fetchCloudUsernames() {
    if (!cloudSyncManager || usernameCache.isLoading) return usernameCache.users;
    
    try {
        usernameCache.isLoading = true;
        const result = await cloudSyncManager.getAllUsersData();
        usernameCache.isLoading = false;
        
        if (result.success && result.data) {
            const cloudUsers = Object.keys(result.data.users || {});
            usernameCache.users = cloudUsers;
            usernameCache.lastUpdated = new Date().toISOString();
            usernameCache.lastRefreshed = new Date().toISOString();
            localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
            return cloudUsers;
        }
    } catch (error) {
        console.error('获取云端用户名失败:', error);
        usernameCache.isLoading = false;
    }
    return usernameCache.users;
}

function setupUsernameCacheRefresh() {
    const cachedData = localStorage.getItem('pes_username_cache');
    if (cachedData) {
        try {
            usernameCache = JSON.parse(cachedData);
        } catch (e) {
            console.error('加载用户名缓存失败:', e);
        }
    }
    
    refreshUsernameCache();
    setInterval(refreshUsernameCache, 2 * 60 * 60 * 1000);
    
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshUsernameCache();
    });
}

async function refreshUsernameCache() {
    if (usernameCache.isLoading) return;
    
    const now = new Date();
    const lastRefreshed = usernameCache.lastRefreshed ? new Date(usernameCache.lastRefreshed) : null;
    const shouldForceRefresh = !lastRefreshed || (now - lastRefreshed) > 24 * 60 * 60 * 1000;
    
    if (shouldForceRefresh) {
        await fetchCloudUsernames();
    }
}

async function isUsernameAvailable(username) {
    // 检查本地用户
    const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
    if (usersData.users.includes(username)) {
        return { available: false, source: 'local' };
    }
    
    // 检查缓存
    const lastUpdated = usernameCache.lastUpdated ? new Date(usernameCache.lastUpdated) : null;
    const now = new Date();
    const isCacheStale = !lastUpdated || (now - lastUpdated) > 4 * 60 * 60 * 1000;
    
    if (isCacheStale) {
        await fetchCloudUsernames();
    }
    
    // 检查云端
    if (usernameCache.users.includes(username)) {
        return { available: false, source: 'cloud' };
    }
    
    return { available: true };
}

function generateUniqueUserId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 状态显示更新
function updateCloudStatus(status, type = 'info') {
    // 登录界面
    const cloudStatusText = document.getElementById('cloud-status-text');
    if (cloudStatusText) cloudStatusText.textContent = status;
    
    const container = document.getElementById('cloud-status-container');
    if (container) {
        container.className = 'stat-item';
        if (type === 'success') container.classList.add('status-success');
        if (type === 'error') container.classList.add('status-error');
        if (type === 'warning') container.classList.add('status-warning');
    }
    
    // 注册界面
    const registerStatusText = document.getElementById('register-cloud-status-text');
    if (registerStatusText) registerStatusText.textContent = status;
    
    const registerContainer = document.getElementById('register-cloud-status');
    if (registerContainer) {
        registerContainer.classList.remove('hidden');
        registerContainer.className = 'cloud-status-hint';
        if (type === 'success') registerContainer.classList.add('status-success');
        if (type === 'error') registerContainer.classList.add('status-error');
        if (type === 'warning') registerContainer.classList.add('status-warning');
    }
    
    // 主界面
    const mainStatusText = document.getElementById('cloud-status-text');
    if (mainStatusText) mainStatusText.textContent = status;
    
    const mainContainer = document.getElementById('cloud-status');
    if (mainContainer) {
        mainContainer.className = 'cloud-status-indicator';
        if (type === 'success') mainContainer.classList.add('connected');
        if (type === 'error') mainContainer.classList.add('disconnected');
        if (type === 'warning') mainContainer.classList.add('warning');
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    const privacyAgreed = localStorage.getItem(CONFIG.PRIVACY_AGREED);
    if (!privacyAgreed) {
        document.getElementById('privacy-agreement').classList.add('active');
    } else {
        continueInitialization();
    }
    
    // 备注字符计数
    const noteTextarea = document.getElementById('daily-note');
    if (noteTextarea) {
        noteTextarea.addEventListener('input', function() {
            document.getElementById('note-chars').textContent = this.value.length;
        });
    }
    
    // 初始化云函数同步
    initCloudSync();
    
    // 加载用户统计数据
    updateUserStats();
    
    // 键盘快捷键
    document.addEventListener('keydown', function(event) {
        if (event.key === 'F1') {
            event.preventDefault();
            showHelp();
        }
        if (event.ctrlKey && event.key === 's') {
            event.preventDefault();
            if (currentUser) saveData();
        }
        if (event.ctrlKey && event.key === 'y') {
            event.preventDefault();
            if (currentUser) copyYesterday();
        }
        if (event.ctrlKey && event.key === 't') {
            event.preventDefault();
            setToday();
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            changeDate(-1);
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            changeDate(1);
        }
    });
    
    // 实时用户名检查
    const usernameInput = document.getElementById('reg-username');
    if (usernameInput) {
        usernameInput.addEventListener('input', function() {
            const username = this.value.trim();
            const statusEl = document.getElementById('username-status');
            
            if (statusEl) {
                statusEl.textContent = '';
                statusEl.className = 'input-status';
                statusEl.style.display = 'none';
                
                if (username.length < 3) return;
                
                if (this.usernameCheckTimeout) clearTimeout(this.usernameCheckTimeout);
                
                this.usernameCheckTimeout = setTimeout(async () => {
                    statusEl.textContent = '检查中...';
                    statusEl.className = 'input-status checking';
                    statusEl.style.display = 'block';
                    
                    try {
                        const result = await isUsernameAvailable(username);
                        if (result.available) {
                            statusEl.textContent = '✓ 用户名可用';
                            statusEl.className = 'input-status valid';
                        } else {
                            statusEl.textContent = '✗ 该用户名已被注册';
                            statusEl.className = 'input-status invalid';
                        }
                    } catch (error) {
                        statusEl.textContent = '⚠️ 检查失败，请稍后重试';
                        statusEl.className = 'input-status invalid';
                    }
                }, 500);
            }
        });
    }
});

// 隐私协议处理
function agreeTerms() {
    if (!document.getElementById('agree-terms').checked) {
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

function continueInitialization() {
    document.getElementById('current-date').value = currentDate;
    showLogin();
    
    const savedUser = localStorage.getItem('pes_current_user');
    if (savedUser) document.getElementById('username').value = savedUser;
    
    generateCalendar();
}

// 用户管理
async function updateUserStats() {
    try {
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        const localUserCount = usersData.users.length;
        
        let cloudUserCount = 0;
        let activeTodayCount = 0;
        
        if (cloudSyncManager) {
            const result = await cloudSyncManager.getAllUsersData();
            if (result.success) {
                cloudUserCount = result.totalUsers || Object.keys(result.data.users || {}).length;
                const today = new Date().toDateString();
                const users = result.data.users || {};
                activeTodayCount = Object.values(users).filter(user => 
                    new Date(user.lastLogin || 0).toDateString() === today
                ).length;
            }
        }
        
        document.getElementById('total-users-count').textContent = Math.max(localUserCount, cloudUserCount);
        document.getElementById('synced-users-count').textContent = cloudUserCount;
        document.getElementById('active-today-count').textContent = activeTodayCount;
        document.getElementById('current-user-count').textContent = localUserCount;
    } catch (error) {
        console.error('更新用户统计失败:', error);
    }
}

function showLogin() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('register-section').classList.add('hidden');
    document.getElementById('main-section').classList.add('hidden');
}

function showRegister() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('register-section').classList.remove('hidden');
    document.getElementById('main-section').classList.add('hidden');
    updateUserStats();
}

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
        const userDataStr = localStorage.getItem(`pes_user_${username}`);
        if (!userDataStr) throw new Error('用户不存在！');
        
        const storedData = JSON.parse(userDataStr);
        if (storedData.password !== password) throw new Error('密码错误！');
        
        currentUser = username;
        userData = storedData;
        
        userData.lastLogin = new Date().toISOString();
        localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
        
        localStorage.setItem('pes_current_user', username);
        document.getElementById('current-user').textContent = `用户: ${username}`;
        
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        document.getElementById('user-count').textContent = `${usersData.users.length}`;
        
        showMain();
        loadDateData();
        updateStats();
        updateSyncStatus();
        updateUserStats();
        
        // 从云端加载数据
        if (userData.syncInfo?.storageMode === 'cloud' && cloudSyncManager) {
            try {
                const cloudResult = await cloudSyncManager.getUserData(username);
                if (cloudResult.success && cloudResult.data) {
                    console.log('发现云端数据，准备合并...');
                }
            } catch (error) {
                console.log('从云端加载数据失败，继续使用本地数据:', error.message);
            }
        }
    } catch (error) {
        alert('登录失败：' + error.message);
    }
}

// 用户注册
async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const confirm = document.getElementById('reg-confirm').value.trim();
    const storageMode = document.querySelector('input[name="storage"]:checked').value;
    
    if (!username || !password || !confirm) {
        alert('请填写所有字段！');
        return;
    }
    
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
    
    const registerBtn = document.querySelector('#register-section button');
    const originalBtnText = registerBtn.innerHTML;
    registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验证用户名...';
    registerBtn.disabled = true;
    
    try {
        const checkResult = await isUsernameAvailable(username);
        if (!checkResult.available) {
            let msg = '该用户名已被注册！';
            if (checkResult.source === 'cloud') {
                msg += '\n此用户名已在云端被其他用户使用，请选择其他用户名。';
                msg += `\n推荐尝试：${username}_${Math.floor(100 + Math.random() * 900)}`;
            } else {
                msg += '\n本设备上已存在同名用户，请使用不同用户名。';
            }
            throw new Error(msg);
        }
        
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        if (usersData.users.length >= CONFIG.MAX_USERS) {
            throw new Error(`用户数量已达上限 ${CONFIG.MAX_USERS} 人！`);
        }
        
        const userRecord = {
            userId: generateUniqueUserId(),
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
        
        localStorage.setItem(`pes_user_${username}`, JSON.stringify(userRecord));
        
        usersData.users.push(username);
        usersData.lastUpdated = new Date().toISOString();
        localStorage.setItem('pes_users', JSON.stringify(usersData));
        
        if (!usernameCache.users.includes(username)) {
            usernameCache.users.push(username);
            usernameCache.lastUpdated = new Date().toISOString();
            localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
        }
        
        alert('注册成功！请登录。');
        showLogin();
        document.getElementById('username').value = username;
        document.getElementById('password').value = password;
        updateUserStats();
    } catch (error) {
        alert('注册失败：' + error.message);
    } finally {
        registerBtn.innerHTML = originalBtnText;
        registerBtn.disabled = false;
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
    updateUserStats();
}

// 数据处理
function getYesterdayData(todayDate) {
    const today = new Date(todayDate);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (userData.records && userData.records[yesterdayStr]) {
        return userData.records[yesterdayStr];
    }
    
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

function loadDateData() {
    const date = document.getElementById('current-date').value;
    currentDate = date;
    
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
        resetForm();
    }
    
    generateCalendar();
}

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
        updatedAt: new Date().toISOString(),
        createdAt: (userData.records?.[date]?.createdAt) || new Date().toISOString()
    };
    
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
    
    if (!userData.records) userData.records = {};
    userData.records[date] = record;
    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
    
    updateDataSourceIndicator('local');
    updateStats();
    generateCalendar();
    
    const notePreview = note ? `\n备注："${note.substring(0, 30)}${note.length > 30 ? '...' : ''}"` : '';
    alert('数据保存成功！' + notePreview);
}

// 表单操作
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

async function copyYesterday() {
    const today = new Date(currentDate);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
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

function setToday() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('current-date').value = today;
    currentDate = today;
    loadDateData();
}

function changeDate(days) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + days);
    const newDate = date.toISOString().split('T')[0];
    document.getElementById('current-date').value = newDate;
    currentDate = newDate;
    loadDateData();
}

// 日历和统计
function generateCalendar() {
    const calendarEl = document.getElementById('calendar');
    const summaryEl = document.getElementById('calendar-summary');
    calendarEl.innerHTML = '';
    summaryEl.innerHTML = '';
    
    const today = new Date();
    const current = new Date(currentDate);
    const year = current.getFullYear();
    const month = current.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay();
    
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    
    for (let i = 0; i < 7; i++) {
        const weekdayEl = document.createElement('div');
        weekdayEl.className = 'calendar-day weekday';
        weekdayEl.textContent = weekdays[i];
        calendarEl.appendChild(weekdayEl);
    }
    
    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'calendar-day empty';
        calendarEl.appendChild(emptyEl);
    }
    
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
        
        if (date === today.toISOString().split('T')[0]) {
            dayEl.classList.add('today');
        }
        
        if (userData.records && userData.records[date]) {
            dayEl.classList.add('has-data');
            const record = userData.records[date];
            
            if (record.note && record.note.trim()) {
                const noteIndicator = document.createElement('div');
                noteIndicator.className = 'note-indicator';
                noteIndicator.innerHTML = '<i class="fas fa-sticky-note"></i>';
                dayEl.appendChild(noteIndicator);
                hasNoteDays++;
            }
            
            const profitLoss = calculateDailyProfitLoss(date);
            if (profitLoss) {
                totalGoldChange += profitLoss.gold || 0;
                totalHeartChange += profitLoss.heart_points || 0;
                totalCouponsChange += profitLoss.highlight_coupons || 0;
                totalCoinsChange += profitLoss.highlight_coins || 0;
                totalNewHighlightChange += profitLoss.new_highlight || 0;
                totalReturnHighlightChange += profitLoss.return_highlight || 0;
                totalExitHighlightChange += profitLoss.exit_highlight || 0;
                hasDataDays++;
                
                const dataEl = document.createElement('div');
                dataEl.className = 'day-data';
                const goldChange = profitLoss.gold || 0;
                const goldClass = goldChange > 0 ? 'profit' : goldChange < 0 ? 'loss' : '';
                dataEl.innerHTML = `<span class="${goldClass}">💰${goldChange >= 0 ? '+' : ''}${goldChange}</span>`;
                dayEl.appendChild(dataEl);
                
                const detailText = `日期: ${date}\n` +
                    `金币: ${goldChange >= 0 ? '+' : ''}${goldChange}\n` +
                    `心仪积分: ${profitLoss.heart_points >= 0 ? '+' : ''}${profitLoss.heart_points}\n` +
                    `高光券: ${profitLoss.highlight_coupons >= 0 ? '+' : ''}${profitLoss.highlight_coupons}\n` +
                    `新高光: ${profitLoss.new_highlight >= 0 ? '+' : ''}${profitLoss.new_highlight}\n` +
                    `返场高光: ${profitLoss.return_highlight >= 0 ? '+' : ''}${profitLoss.return_highlight}\n` +
                    `退场高光: ${profitLoss.exit_highlight >= 0 ? '+' : ''}${profitLoss.exit_highlight}\n` +
                    `高光币: ${profitLoss.highlight_coins >= 0 ? '+' : ''}${profitLoss.highlight_coins}` +
                    (record.note ? `\n备注: ${record.note}` : '');
                dayEl.title = detailText;
            }
        }
        
        const dayNumberEl = document.createElement('div');
        dayNumberEl.className = 'day-number';
        dayNumberEl.textContent = day;
        dayEl.appendChild(dayNumberEl);
        
        dayEl.onclick = function() {
            document.getElementById('current-date').value = date;
            currentDate = date;
            loadDateData();
        };
        
        calendarEl.appendChild(dayEl);
    }
    
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

function updateStats() {
    if (!userData.records) userData.records = {};
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    let todayGold = 0, todayHeart = 0, todayCoupons = 0, todayCoins = 0;
    let todayNewHighlight = 0, todayReturnHighlight = 0, todayExitHighlight = 0;
    
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
    
    let monthGoldChange = 0, monthHeartChange = 0, monthCouponsChange = 0, monthCoinsChange = 0;
    let monthNewHighlightChange = 0, monthReturnHighlightChange = 0, monthExitHighlightChange = 0;
    
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
    
    updateStatCard('total-gold', todayGold, monthGoldChange);
    updateStatCard('total-heart', todayHeart, monthHeartChange);
    updateStatCard('total-coupons', todayCoupons, monthCouponsChange);
    updateStatCard('total-coins', todayCoins, monthCoinsChange);
    updateStatCard('total-new-highlight', todayNewHighlight, monthNewHighlightChange);
    updateStatCard('total-return-highlight', todayReturnHighlight, monthReturnHighlightChange);
    updateStatCard('total-exit-highlight', todayExitHighlight, monthExitHighlightChange);
}

function updateStatCard(elementId, todayValue, monthChange) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.textContent = todayValue;
    
    const oldChange = element.nextElementSibling;
    if (oldChange && oldChange.classList.contains('change-value')) {
        oldChange.remove();
    }
    
    if (monthChange !== 0) {
        const changeElement = document.createElement('span');
        changeElement.className = `change-value ${monthChange > 0 ? 'positive' : 'negative'}`;
        changeElement.textContent = `${monthChange > 0 ? '+' : ''}${monthChange}`;
        element.parentElement.appendChild(changeElement);
    }
}

// 云端同步
async function syncToCloud() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    if (!cloudSyncManager) {
        alert('云同步功能未配置，请联系管理员！');
        return;
    }
    
    const syncInfo = userData.syncInfo || {};
    const today = new Date().toDateString();
    
    if (syncInfo.lastSyncDate === today && syncInfo.syncCountToday >= CONFIG.SYNC_LIMIT_PER_DAY) {
        alert(`今天已经同步过 ${CONFIG.SYNC_LIMIT_PER_DAY} 次了，请明天再试！`);
        return;
    }
    
    if (!confirm(`⚠️ 数据将同步到云端\n${CONFIG.PRIVACY_WARNING}\n确定要同步吗？`)) {
        return;
    }
    
    const syncBtn = document.getElementById('sync-button');
    const originalText = syncBtn.innerHTML;
    const originalDisabled = syncBtn.disabled;
    syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同步中...';
    syncBtn.disabled = true;
    
    try {
        const syncData = {
            ...userData,
            lastSync: new Date().toISOString()
        };
        
        const result = await cloudSyncManager.updateUserData(currentUser, syncData);
        if (result.success) {
            if (!userData.syncInfo) userData.syncInfo = {};
            
            if (syncInfo.lastSyncDate !== today) {
                userData.syncInfo.syncCountToday = 1;
            } else {
                userData.syncInfo.syncCountToday = (syncInfo.syncCountToday || 0) + 1;
            }
            userData.syncInfo.lastSyncDate = today;
            userData.syncInfo.lastSyncTime = new Date().toISOString();
            
            localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
            updateSyncStatus();
            updateDataSourceIndicator('synced');
            
            await fetchCloudUsernames();
            updateUserStats();
            
            alert(`✅ 同步成功！\n• 总用户数: ${result.userCount}/${CONFIG.MAX_USERS}\n• 今日剩余同步次数: ${CONFIG.SYNC_LIMIT_PER_DAY - userData.syncInfo.syncCountToday}\n数据已安全存储在云端！`);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('同步失败:', error);
        alert(`❌ 同步失败: ${error.message}\n数据已保存在本地，请稍后重试。`);
        updateDataSourceIndicator('local');
    } finally {
        syncBtn.innerHTML = originalText;
        syncBtn.disabled = originalDisabled;
    }
}

function updateSyncStatus() {
    if (!currentUser) return;
    
    const syncInfo = userData.syncInfo || {};
    const today = new Date().toDateString();
    
    const syncCountElement = document.getElementById('sync-count');
    const syncStatusElement = document.getElementById('sync-status');
    
    if (syncCountElement) syncCountElement.textContent = syncInfo.syncCountToday || 0;
    
    if (syncStatusElement) {
        if (syncInfo.lastSyncDate === today && syncInfo.syncCountToday >= CONFIG.SYNC_LIMIT_PER_DAY) {
            syncStatusElement.className = 'sync-status limit-reached';
        } else {
            syncStatusElement.className = 'sync-status';
        }
    }
}

// 数据源指示器
function updateDataSourceIndicator(source) {
    document.getElementById('data-source-local').classList.add('hidden');
    document.getElementById('data-source-synced').classList.add('hidden');
    document.getElementById('data-source-outdated').classList.add('hidden');
    
    if (source === 'local') {
        document.getElementById('data-source-local').classList.remove('hidden');
    } else if (source === 'synced') {
        const syncInfo = userData.syncInfo || {};
        const today = new Date().toDateString();
        if (syncInfo.lastSyncDate === today) {
            document.getElementById('data-source-synced').classList.remove('hidden');
        } else {
            document.getElementById('data-source-outdated').classList.remove('hidden');
        }
    } else if (source === 'outdated') {
        document.getElementById('data-source-outdated').classList.remove('hidden');
    }
}

// 数据导出导入
function exportData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    const dataStr = JSON.stringify(userData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = `pes_data_${currentUser}_${currentDate}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    alert('数据导出成功！');
}

function importData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    if (!confirm('警告：导入数据会覆盖当前所有记录！\n确定要继续吗？')) {
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
                if (!importedData.username || !importedData.records) {
                    throw new Error('文件格式错误：不是有效的备份文件');
                }
                
                const recordCount = Object.keys(importedData.records || {}).length;
                if (!confirm(`即将导入 ${recordCount} 条记录，这将覆盖当前数据，确定要导入吗？`)) {
                    return;
                }
                
                userData = importedData;
                localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
                alert(`数据导入成功！已导入 ${recordCount} 条记录。`);
                
                loadDateData();
                updateStats();
                generateCalendar();
                updateSyncStatus();
            } catch (error) {
                alert('导入失败：' + error.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// 备注历史
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
        const notes = [];
        for (const [date, record] of Object.entries(userData.records)) {
            if (record.note && record.note.trim()) {
                notes.push({ date, note: record.note, createdAt: record.createdAt });
            }
        }
        
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
                </div>`;
                historyContent.appendChild(noteElement);
            });
        }
    }
    
    document.getElementById('note-history-dialog').classList.add('active');
}

function closeNoteHistory() {
    document.getElementById('note-history-dialog').classList.remove('active');
}

// 管理员
function openAdmin() {
    const password = prompt('请输入管理员密码：');
    if (password === CONFIG.ADMIN_PASSWORD) {
        window.open('admin.html', '_blank');
    } else {
        alert('密码错误！提示：123456');
    }
}

// 帮助文档
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
    </ol>
    </div>
    <div class="help-section">
    <h3><i class="fas fa-database"></i> 数据管理</h3>
    <h4>导出数据（备份）</h4>
    <ol class="help-list steps">
    <li>点击右上角<strong>"导出"</strong>按钮（绿色）</li>
    <li>浏览器会自动下载备份文件：<code>pes_data_用户名_日期.json</code></li>
    </ol>
    <h4>导入数据（恢复）</h4>
    <ol class="help-list steps">
    <li>点击右上角<strong>"导入"</strong>按钮（蓝色）</li>
    <li>选择之前导出的JSON文件</li>
    <li>确认后会覆盖当前数据</li>
    </ol>
    <h4>云端同步</h4>
    <ol class="help-list steps">
    <li>点击右上角<strong>"同步"</strong>按钮（深绿色）</li>
    <li>每天限同步1次</li>
    <li>数据将通过云函数存储在GitHub云端</li>
    <li><strong>注意：</strong>您的数据默认保存在本地，同步是手动操作</li>
    <li><strong>请勿</strong>上传任何敏感或个人信息</li>
    </ol>
    <div class="warning">
    <p><i class="fas fa-exclamation-triangle"></i> <strong>警告：</strong>上传到云端的数据管理员可以看到，请仅上传游戏资源数据。</p>
    </div>
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
    </div>
    `;
    document.getElementById('help-dialog').classList.add('active');
}

function closeHelp() {
    document.getElementById('help-dialog').classList.remove('active');
}

// 其他功能
function showPrivacyInfo() {
    alert('隐私政策：\n1. 数据默认存储在浏览器本地\n2. 选择云端同步后，数据将通过云函数存储在GitHub Gist中\n3. 管理员可以看到GitHub上的所有用户数据\n4. 请勿存储任何敏感个人信息\n5. 建议定期导出数据备份');
}

function showAbout() {
    alert('关于实况足球资源记录器：\n版本：v2.0（使用云函数后端）\n功能：记录游戏资源、计算盈亏、数据备份和云端同步\n说明：完全免费，仅供学习交流使用\n作者：实况足球爱好者\n更新日期：2024年\n后端架构：腾讯云函数 + GitHub API');
}

async function testCloudConnection() {
    if (!cloudSyncManager) {
        alert('云函数同步管理器未初始化');
        return;
    }
    
    try {
        const testResult = await cloudSyncManager.testConnection();
        let message = `测试结果:\n1. 连接测试: ${testResult.success ? '✅ 成功' : '❌ 失败'}\n${testResult.message}`;
        
        if (testResult.success) {
            const gistResult = await cloudSyncManager.getAllUsersData();
            message += `\n2. Gist访问: ${gistResult.success ? '✅ 成功' : '❌ 失败'}\n${gistResult.message || gistResult.error || '无错误信息'}`;
            if (gistResult.success) {
                message += `\n总用户数: ${gistResult.totalUsers || 0}`;
                message += `\n最后更新: ${gistResult.lastUpdated ? new Date(gistResult.lastUpdated).toLocaleString('zh-CN') : '未知'}`;
            }
        }
        
        alert(message);
    } catch (error) {
        console.error('测试失败:', error);
        alert('测试失败: ' + error.message);
    }
}
