// 全局变量
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
        lastUploadTime: '',
        lastDownloadTime: ''
    },
    records: {}
};
let cloudSyncManager = null;
let usernameCache = {
    users: [],
    lastUpdated: null,
    isLoading: false
};

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
            const testUrl = this.buildUrl(this.apiPaths.TEST || '/test');
            const response = await this.sendRequest(testUrl, { method: 'GET' });
            const result = await response.json();
            
            if (result.success) {
                return {
                    success: true,
                    message: result.message,
                    data: result.data,
                    status: result.status
                };
            } else {
                throw new Error(result.message || '连接测试失败');
            }
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
                // 更新用户名缓存
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
            } else {
                throw new Error(result.message || '获取数据失败');
            }
        } catch (error) {
            console.error('获取数据失败:', error);
            
            // 返回缓存数据（如果有的话）
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
    
    async checkUsernameAvailability(username) {
        try {
            const url = this.buildUrl(this.apiPaths.CHECK_USERNAME || '/check-username');
            const response = await this.sendRequest(url, {
                method: 'POST',
                body: JSON.stringify({ username })
            });
            const result = await response.json();
            
            if (result.success) {
                return {
                    available: result.available,
                    exists: !result.available,
                    message: result.message || '用户名检查完成'
                };
            } else {
                throw new Error(result.message || '检查用户名失败');
            }
        } catch (error) {
            console.error('检查用户名失败:', error);
            return {
                available: true, // 网络错误时假设可用，但提示用户
                exists: false,
                error: error.message,
                message: '网络连接问题，无法验证用户名唯一性'
            };
        }
    }
    
    async registerUsername(username, userData) {
        try {
            const url = this.buildUrl(this.apiPaths.REGISTER || '/register');
            const response = await this.sendRequest(url, {
                method: 'POST',
                body: JSON.stringify({ username, userData })
            });
            const result = await response.json();
            
            if (result.success) {
                return {
                    success: true,
                    message: result.message || '用户名注册成功',
                    userCount: result.userCount || 0,
                    lastUpdated: result.lastUpdated
                };
            } else {
                throw new Error(result.message || '注册用户名失败');
            }
        } catch (error) {
            console.error('注册用户名失败:', error);
            return {
                success: false,
                error: error.message,
                message: '无法注册用户名'
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
                    exists: !!result.data,
                    message: result.message || '获取用户数据成功'
                };
            } else {
                throw new Error(result.message || '获取用户数据失败');
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
    
    async updateUserToCloud(username, userData) {
        try {
            if (!username || !userData) throw new Error('用户名和用户数据不能为空');
            
            const url = this.buildUrl(this.apiPaths.USER || '/user');
            const response = await this.sendRequest(url, {
                method: 'POST',
                body: JSON.stringify({
                    username: username,
                    userData: userData,
                    action: 'upload'
                })
            });
            const result = await response.json();
            
            if (result.success) {
                return {
                    success: true,
                    message: result.message || '数据上传成功',
                    userCount: result.userCount || 0,
                    lastUpdated: result.lastUpdated
                };
            } else {
                throw new Error(result.message || '上传数据失败');
            }
        } catch (error) {
            console.error('上传数据失败:', error);
            return {
                success: false,
                error: error.message,
                message: '上传到云端失败'
            };
        }
    }
    
    async downloadUserFromCloud(username) {
        try {
            if (!username) throw new Error('用户名不能为空');
            
            const url = this.buildUrl(`${this.apiPaths.USER || '/user'}?username=${encodeURIComponent(username)}&action=download`);
            const response = await this.sendRequest(url, { method: 'GET' });
            const result = await response.json();
            
            if (result.success) {
                return {
                    success: true,
                    data: result.data,
                    lastUpdated: result.lastUpdated,
                    message: result.message || '数据下载成功'
                };
            } else {
                throw new Error(result.message || '下载数据失败');
            }
        } catch (error) {
            console.error('下载数据失败:', error);
            return {
                success: false,
                error: error.message,
                message: '从云端下载失败'
            };
        }
    }
}

// 初始化云函数同步
function initCloudSync() {
    console.log('初始化云函数同步管理器...');
    try {
        // 验证配置
        if (!CONFIG.CLOUD_BACKEND.URL || CONFIG.CLOUD_BACKEND.URL.includes('你的云函数地址')) {
            console.warn('云函数配置不完整，同步功能不可用');
            updateCloudStatus('未配置', 'warning');
            return;
        }
        
        cloudSyncManager = new CloudSyncManager();
        console.log('CloudSyncManager创建成功');
        updateCloudStatus('检测中', 'info');
        
        // 测试连接
        setTimeout(async () => {
            const result = await cloudSyncManager.testConnection();
            
            if (result.success) {
                updateCloudStatus('已连接', 'success');
                console.log('云函数连接测试成功:', result.message);
                
                // 初始化用户名缓存
                await fetchAndCacheUsernames();
                
                // 更新按钮状态
                document.getElementById('upload-button').disabled = false;
                document.getElementById('upload-button').title = '上传数据到云端';
            } else {
                updateCloudStatus('连接失败', 'error');
                console.warn('云函数连接测试失败:', result.message);
                
                // 更新按钮状态
                document.getElementById('upload-button').innerHTML = '<i class="fas fa-exclamation-triangle"></i> 连接失败';
                document.getElementById('upload-button').title = result.message;
                document.getElementById('upload-button').disabled = true;
            }
        }, 500);
    } catch (error) {
        console.error('初始化云函数同步管理器失败:', error);
        updateCloudStatus('初始化失败', 'error');
    }
}

// 获取并缓存用户名
async function fetchAndCacheUsernames() {
    if (!cloudSyncManager) return;
    
    try {
        console.log('正在获取并缓存用户名...');
        usernameCache.isLoading = true;
        
        const result = await cloudSyncManager.getAllUsersData();
        
        if (result.success && result.data) {
            const cloudUsers = Object.keys(result.data.users || {});
            usernameCache.users = cloudUsers;
            usernameCache.lastUpdated = new Date().toISOString();
            localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
            console.log(`缓存了 ${cloudUsers.length} 个用户名`);
        }
    } catch (error) {
        console.error('获取用户名失败:', error);
    } finally {
        usernameCache.isLoading = false;
    }
}

// 验证用户名唯一性
async function validateUsernameUniqueness(username, isRegistration = false) {
    if (!cloudSyncManager) {
        throw new Error('云函数未配置，无法验证用户名唯一性');
    }
    
    const usernameStatus = document.getElementById('username-status');
    if (usernameStatus) {
        usernameStatus.textContent = '验证用户名中...';
        usernameStatus.className = 'input-status checking';
    }
    
    try {
        const checkResult = await cloudSyncManager.checkUsernameAvailability(username);
        
        // 检查本地缓存
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        const localExists = usersData.users.includes(username);
        
        if (checkResult.exists || localExists) {
            if (usernameStatus) {
                usernameStatus.textContent = '该用户名已被占用';
                usernameStatus.className = 'input-status invalid';
            }
            return false;
        }
        
        if (usernameStatus) {
            usernameStatus.textContent = '用户名可用';
            usernameStatus.className = 'input-status valid';
        }
        return true;
    } catch (error) {
        console.error('验证用户名失败:', error);
        if (usernameStatus) {
            usernameStatus.textContent = '验证失败，无法检查用户名唯一性';
            usernameStatus.className = 'input-status invalid';
        }
        
        if (!isRegistration) {
            // 登录时，网络错误允许继续
            return true;
        }
        
        throw error;
    }
}

// 更新云端状态显示
function updateCloudStatus(status, type = 'info') {
    // 登录界面
    const cloudStatusText = document.getElementById('cloud-status-text');
    if (cloudStatusText) cloudStatusText.textContent = status;
    
    const container = document.getElementById('cloud-status-container');
    if (container) {
        container.className = 'stat-item';
        container.classList.toggle('status-success', type === 'success');
        container.classList.toggle('status-error', type === 'error');
        container.classList.toggle('status-warning', type === 'warning');
    }
    
    // 主界面
    const mainStatusText = document.getElementById('cloud-status-text');
    if (mainStatusText) mainStatusText.textContent = status;
    
    const mainContainer = document.getElementById('cloud-status');
    if (mainContainer) {
        mainContainer.className = 'cloud-status-indicator';
        mainContainer.classList.toggle('connected', type === 'success');
        mainContainer.classList.toggle('disconnected', type === 'error');
        mainContainer.classList.toggle('warning', type === 'warning');
    }
}

// 清空所有本地数据
function clearAllLocalData() {
    showConfirmDialog(
        '清空本地数据',
        '警告：这将删除所有本地数据，包括用户账户和记录！<br>此操作无法撤销。确定要继续吗？',
        () => {
            localStorage.clear();
            alert('本地数据已清空，页面将刷新');
            location.reload();
        }
    );
}

// 显示确认对话框
function showConfirmDialog(title, content, confirmCallback, cancelCallback) {
    document.getElementById('confirm-title').innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${title}`;
    document.getElementById('confirm-content').innerHTML = content;
    
    // 保存回调
    window.currentConfirmCallback = confirmCallback;
    window.currentCancelCallback = cancelCallback;
    
    document.getElementById('confirm-dialog').classList.remove('hidden');
}

// 关闭确认对话框
function closeConfirmDialog() {
    document.getElementById('confirm-dialog').classList.add('hidden');
    window.currentConfirmCallback = null;
    window.currentCancelCallback = null;
}

// 确认操作
function confirmAction() {
    if (window.currentConfirmCallback) {
        window.currentConfirmCallback();
    }
    closeConfirmDialog();
}

// 取消操作
function cancelConfirmAction() {
    if (window.currentCancelCallback) {
        window.currentCancelCallback();
    }
    closeConfirmDialog();
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检查隐私协议
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
    
    // 实时用户名验证
    const regUsernameInput = document.getElementById('reg-username');
    if (regUsernameInput) {
        regUsernameInput.addEventListener('input', function(e) {
            const username = this.value.trim();
            const usernameStatus = document.getElementById('username-status');
            
            if (usernameStatus) {
                usernameStatus.textContent = '';
                usernameStatus.className = 'input-status';
            }
            
            if (username.length < 3 || username.length > 15) {
                if (usernameStatus) {
                    usernameStatus.textContent = '用户名需3-15个字符';
                    usernameStatus.className = 'input-status invalid';
                }
                return;
            }
            
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                if (usernameStatus) {
                    usernameStatus.textContent = '只能包含字母、数字和下划线';
                    usernameStatus.className = 'input-status invalid';
                }
                return;
            }
            
            // 防抖
            clearTimeout(this.validateTimeout);
            this.validateTimeout = setTimeout(async () => {
                try {
                    await validateUsernameUniqueness(username);
                } catch (error) {
                    console.error('实时验证失败:', error);
                }
            }, 500);
        });
    }
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

function continueInitialization() {
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
        // 本地用户统计
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        const localUserCount = usersData.users.length;
        
        // 云端用户统计
        let cloudUserCount = 0;
        let activeTodayCount = 0;
        
        if (cloudSyncManager) {
            const result = await cloudSyncManager.getAllUsersData();
            if (result.success && result.data) {
                cloudUserCount = Object.keys(result.data.users || {}).length;
                const today = new Date().toDateString();
                activeTodayCount = Object.values(result.data.users || {}).filter(user => 
                    new Date(user.lastLogin || 0).toDateString() === today
                ).length;
            }
        }
        
        // 更新UI
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
    
    // 清空状态
    const usernameStatus = document.getElementById('username-status');
    if (usernameStatus) {
        usernameStatus.textContent = '';
        usernameStatus.className = 'input-status';
    }
    
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
        
        // 设置当前用户 - 移除不必要的验证
        currentUser = username;
        userData = storedData;
        
        // 不再调用 validateAndFixUserData 和 ensureUserDataStructure
        // 这两个函数可能触发用户名冲突检查
        
        // 更新最后登录时间
        userData.lastLogin = new Date().toISOString();
        localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
        
        // 保存登录信息
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
        }
        
        // 尝试从云端加载用户数据（如果开启了云同步）- 增强错误处理
        if (userData.syncInfo && userData.syncInfo.storageMode === 'cloud' && cloudSyncManager) {
            try {
                const cloudResult = await cloudSyncManager.getUserData(username);
                if (cloudResult.success && cloudResult.data) {
                    console.log('从云端加载数据成功');
                    // 可以在这里实现数据合并逻辑
                }
            } catch (error) {
                // 只记录错误，不阻止登录
                console.log('从云端加载数据失败，继续使用本地数据:', error.message);
            }
        }
    } catch (error) {
        alert('登录失败：' + error.message);
    }
}

// 检查云端是否有更新
async function checkForCloudUpdates() {
    if (!currentUser || !cloudSyncManager) return;
    
    try {
        const cloudResult = await cloudSyncManager.getUserData(currentUser);
        if (cloudResult.success && cloudResult.data) {
            // 检查最后更新时间
            const cloudLastUpdated = new Date(cloudResult.data.lastUpdated || 0);
            const localLastUpdated = new Date(userData.lastUpdated || 0);
            
            if (cloudLastUpdated > localLastUpdated) {
                document.getElementById('data-source-cloud').classList.remove('hidden');
                document.getElementById('data-source-local').classList.add('hidden');
            }
        }
    } catch (error) {
        console.log('检查云端更新失败:', error.message);
    }
}

// 用户注册
async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const confirm = document.getElementById('reg-confirm').value.trim();
    
    if (!username || !password || !confirm) {
        alert('请填写所有字段！');
        return;
    }
    
    // 用户名格式验证
    if (!/^[a-zA-Z0-9_]{3,15}$/.test(username)) {
        alert('用户名需3-15个字符，只能包含字母、数字和下划线！');
        return;
    }
    
    // 密码验证
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
    registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 注册中...';
    registerBtn.disabled = true;
    
    try {
        // 验证用户名唯一性
        const isUnique = await validateUsernameUniqueness(username, true);
        if (!isUnique) {
            throw new Error('该用户名已被占用，请尝试其他名称');
        }
        
        // 检查用户数量限制
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        if (usersData.users.length >= CONFIG.MAX_USERS) {
            throw new Error(`用户数量已达上限 ${CONFIG.MAX_USERS} 人！`);
        }
        
        // 创建新用户
        const userId = generateUniqueUserId();
        const userRecord = {
            userId: userId,
            username: username,
            password: password,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            syncInfo: {
                lastSyncDate: '',
                syncCountToday: 0,
                lastUploadTime: '',
                lastDownloadTime: ''
            },
            records: {},
            version: '2.1'
        };
        
        // 保存到本地
        localStorage.setItem(`pes_user_${username}`, JSON.stringify(userRecord));
        
        // 更新用户列表
        usersData.users.push(username);
        localStorage.setItem('pes_users', JSON.stringify(usersData));
        
        // 注册到云端
        const registerResult = await cloudSyncManager.registerUsername(username, userRecord);
        if (!registerResult.success) {
            throw new Error(registerResult.message || '云端注册失败');
        }
        
        // 更新缓存
        usernameCache.users.push(username);
        usernameCache.lastUpdated = new Date().toISOString();
        localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
        
        alert('注册成功！请登录。');
        showLogin();
        document.getElementById('username').value = username;
        document.getElementById('password').value = password;
        
        // 更新统计
        updateUserStats();
    } catch (error) {
        alert('注册失败：' + error.message);
    } finally {
        // 恢复按钮状态
        registerBtn.innerHTML = originalBtnText;
        registerBtn.disabled = false;
    }
}

// 生成唯一用户ID
function generateUniqueUserId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
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
            lastUploadTime: '',
            lastDownloadTime: ''
        },
        records: {}
    };
    localStorage.removeItem('pes_current_user');
    showLogin();
    updateUserStats();
}

// 保存数据到本地
function saveData() {
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
    
    // 保存数据
    if (!userData.records) userData.records = {};
    userData.records[date] = record;
    userData.lastUpdated = new Date().toISOString();
    
    // 保存到本地存储
    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
    
    // 更新数据源指示器
    document.getElementById('data-source-local').classList.remove('hidden');
    document.getElementById('data-source-cloud').classList.add('hidden');
    
    // 更新UI
    updateStats();
    generateCalendar();
    
    const notePreview = note ? `\n备注："${note.substring(0, 30)}${note.length > 30 ? '...' : ''}"` : '';
    alert('数据已保存到本地！' + notePreview);
    
    // 检查云端是否有更新
    checkForCloudUpdates();
}

// 加载指定日期的数据
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

// 获取昨日数据
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

// 计算每日盈亏
function calculateDailyProfitLoss(date) {
    const todayData = userData.records?.[date];
    if (!todayData) return null;
    
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const yesterdayData = userData.records?.[yesterdayStr] || {
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

// 复制昨日数据
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
    
    if (!calendarEl || !summaryEl) return;
    
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
    
    // 添加星期标题
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
            const record = userData.records[date];
            
            // 检查是否有备注
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
                // 累加到本月总盈亏
                totalGoldChange += profitLoss.gold || 0;
                totalHeartChange += profitLoss.heart_points || 0;
                totalCouponsChange += profitLoss.highlight_coupons || 0;
                totalCoinsChange += profitLoss.highlight_coins || 0;
                totalNewHighlightChange += profitLoss.new_highlight || 0;
                totalReturnHighlightChange += profitLoss.return_highlight || 0;
                totalExitHighlightChange += profitLoss.exit_highlight || 0;
                hasDataDays++;
                
                // 添加数据提示
                const dataEl = document.createElement('div');
                dataEl.className = 'day-data';
                const goldChange = profitLoss.gold || 0;
                const goldClass = goldChange > 0 ? 'profit' : goldChange < 0 ? 'loss' : '';
                dataEl.innerHTML = `<span class="${goldClass}">💰${goldChange >= 0 ? '+' : ''}${goldChange}</span>`;
                dayEl.appendChild(dataEl);
                
                // 添加详情提示
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
        
        // 点击日期跳转
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
    
    // 移除旧的盈亏显示
    const oldChange = element.nextElementSibling;
    if (oldChange && oldChange.classList.contains('change-value')) {
        oldChange.remove();
    }
    
    // 添加新的盈亏显示
    if (monthChange !== 0) {
        const changeElement = document.createElement('span');
        changeElement.className = `change-value ${monthChange > 0 ? 'positive' : 'negative'}`;
        changeElement.textContent = `${monthChange > 0 ? '+' : ''}${monthChange}`;
        element.parentElement.appendChild(changeElement);
    }
}

// 上传数据到云端
async function uploadToCloud() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    if (!cloudSyncManager) {
        alert('云同步功能未配置，请联系管理员！');
        return;
    }
    
    // 检查上传限制
    const syncInfo = userData.syncInfo || {};
    const today = new Date().toDateString();
    
    if (syncInfo.lastUploadTime && new Date(syncInfo.lastUploadTime).toDateString() === today) {
        if (confirm(`您今天已经上传过数据，确定要覆盖上传最新数据吗？\n注意：这将覆盖云端现有数据！`)) {
            performUpload();
        }
    } else {
        performUpload();
    }
}

async function performUpload() {
    const confirmMsg = `⚠️ 确认上传数据到云端
${CONFIG.PRIVACY_WARNING}
上传后，您的数据将存储在管理员GitHub中，管理员可以查看这些数据。
确定要上传吗？`;
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    const uploadBtn = document.getElementById('upload-button');
    const originalText = uploadBtn.innerHTML;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传中...';
    uploadBtn.disabled = true;
    
    try {
        // 准备上传数据
        const uploadData = {
            ...userData,
            lastUploadTime: new Date().toISOString(),
            version: '2.1'
        };
        
        const result = await cloudSyncManager.updateUserToCloud(currentUser, uploadData);
        
        if (result.success) {
            // 更新本地同步信息
            if (!userData.syncInfo) userData.syncInfo = {};
            userData.syncInfo.lastUploadTime = new Date().toISOString();
            userData.lastUpdated = new Date().toISOString();
            localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
            
            // 更新UI
            document.getElementById('data-source-local').classList.add('hidden');
            document.getElementById('data-source-cloud').classList.remove('hidden');
            
            alert(`✅ 上传成功！
• 数据已上传到云端
• 最后上传时间: ${new Date().toLocaleString('zh-CN')}`);
            
            // 更新用户统计
            updateUserStats();
        } else {
            throw new Error(result.message || '上传失败');
        }
    } catch (error) {
        console.error('上传失败:', error);
        alert(`❌ 上传失败: ${error.message}\n数据已保存在本地，请稍后重试。`);
    } finally {
        uploadBtn.innerHTML = originalText;
        uploadBtn.disabled = false;
    }
}

// 从云端下载数据
async function downloadFromCloud() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    if (!cloudSyncManager) {
        alert('云同步功能未配置，请联系管理员！');
        return;
    }
    
    if (!confirm('⚠️ 从云端下载数据\n这将用云端数据覆盖本地所有记录！\n确定要下载吗？')) {
        return;
    }
    
    const downloadEl = document.querySelector('.btn-download');
    const originalText = downloadEl.innerHTML;
    downloadEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 下载中...';
    downloadEl.disabled = true;
    
    try {
        const result = await cloudSyncManager.downloadUserFromCloud(currentUser);
        
        if (result.success && result.data) {
            // 备份当前本地数据
            const backupData = JSON.parse(JSON.stringify(userData));
            localStorage.setItem(`pes_user_${currentUser}_backup`, JSON.stringify(backupData));
            
            // 应用云端数据
            userData = {
                ...userData, // 保留密码等本地信息
                records: result.data.records || {},
                syncInfo: {
                    ...userData.syncInfo,
                    lastDownloadTime: new Date().toISOString()
                },
                lastUpdated: result.lastUpdated || new Date().toISOString(),
                version: '2.1'
            };
            
            // 保存到本地
            localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
            
            // 更新UI
            document.getElementById('data-source-local').classList.add('hidden');
            document.getElementById('data-source-cloud').classList.remove('hidden');
            loadDateData();
            updateStats();
            generateCalendar();
            
            alert(`✅ 下载成功！
• 云端数据已覆盖本地数据
• 最后下载时间: ${new Date().toLocaleString('zh-CN')}
• 原始数据已备份，如需恢复请导入备份文件`);
        } else {
            throw new Error(result.message || '下载失败');
        }
    } catch (error) {
        console.error('下载失败:', error);
        alert(`❌ 下载失败: ${error.message}\n请检查网络连接后重试。`);
    } finally {
        downloadEl.innerHTML = originalText;
        downloadEl.disabled = false;
    }
}

// 导出数据
function exportData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    const exportType = confirm('选择导出类型：\n确定 - 仅导出当前用户数据\n取消 - 导出所有用户数据');
    
    if (exportType) {
        // 导出当前用户数据
        const dataStr = JSON.stringify(userData, null, 2);
        const dataUri = 'application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = `pes_data_${currentUser}_${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        alert('当前用户数据导出成功！');
    } else {
        // 导出所有用户数据
        const allUsersData = {};
        const usersData = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
        
        for (const username of usersData.users) {
            const userDataStr = localStorage.getItem(`pes_user_${username}`);
            if (userDataStr) {
                allUsersData[username] = JSON.parse(userDataStr);
            }
        }
        
        if (Object.keys(allUsersData).length === 0) {
            alert('没有可导出的用户数据');
            return;
        }
        
        const dataStr = JSON.stringify({
            version: '2.1',
            exportDate: new Date().toISOString(),
            users: allUsersData
        }, null, 2);
        
        const dataUri = 'application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = `pes_all_users_${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        alert(`所有用户数据导出成功！共 ${Object.keys(allUsersData).length} 个用户`);
    }
}

// 导入数据
function importData() {
    if (!confirm('⚠️ 从文件恢复数据\n这将用导入的数据覆盖当前本地数据！\n确定要导入吗？')) {
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
                
                if (importedData.users && typeof importedData.users === 'object') {
                    // 导入所有用户数据
                    showConfirmDialog(
                        '导入所有用户数据',
                        `检测到包含 ${Object.keys(importedData.users).length} 个用户的完整备份文件<br>这将覆盖当前所有用户数据，确定要继续吗？`,
                        () => {
                            importAllUsersData(importedData.users);
                        }
                    );
                } else if (importedData.username) {
                    // 导入单个用户数据
                    if (currentUser && importedData.username !== currentUser) {
                        showConfirmDialog(
                            '用户名不匹配',
                            `备份文件用户名: ${importedData.username}<br>当前登录用户: ${currentUser}<br>确定要强制导入吗？这将覆盖当前用户数据`,
                            () => {
                                importSingleUserData(importedData);
                            }
                        );
                    } else {
                        importSingleUserData(importedData);
                    }
                } else {
                    throw new Error('文件格式错误：不是有效的备份文件');
                }
            } catch (error) {
                alert('导入失败：' + error.message);
            }
        };
        reader.readAsText(file);
    };
    
    input.click();
}

function importSingleUserData(importedData) {
    if (!currentUser) {
        alert('请先登录再导入数据');
        return;
    }
    
    // 保留密码
    const currentPassword = userData.password;
    
    // 合并数据
    userData = {
        ...importedData,
        password: currentPassword, // 保留当前密码
        lastLogin: new Date().toISOString(),
        version: '2.1'
    };
    
    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
    
    loadDateData();
    updateStats();
    generateCalendar();
    
    alert('数据导入成功！');
}

function importAllUsersData(usersData) {
    // 备份当前所有数据
    const usersBackup = JSON.parse(localStorage.getItem('pes_users') || '{"users": []}');
    localStorage.setItem('pes_users_backup', JSON.stringify(usersBackup));
    
    // 导入用户列表
    const newUsersList = { users: Object.keys(usersData) };
    localStorage.setItem('pes_users', JSON.stringify(newUsersList));
    
    // 导入用户数据
    for (const [username, userData] of Object.entries(usersData)) {
        localStorage.setItem(`pes_user_${username}`, JSON.stringify(userData));
    }
    
    // 更新用户名缓存
    usernameCache.users = newUsersList.users;
    usernameCache.lastUpdated = new Date().toISOString();
    localStorage.setItem('pes_username_cache', JSON.stringify(usernameCache));
    
    alert(`所有用户数据导入成功！共 ${newUsersList.users.length} 个用户`);
    
    // 如果当前有登录用户，重新加载
    if (currentUser && newUsersList.users.includes(currentUser)) {
        const userDataStr = localStorage.getItem(`pes_user_${currentUser}`);
        if (userDataStr) {
            userData = JSON.parse(userDataStr);
            loadDateData();
            updateStats();
            generateCalendar();
        }
    }
    
    updateUserStats();
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
        document.getElementById('note-history-dialog').classList.add('active');
        return;
    }
    
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
                <li><strong>注册账户</strong>：首次使用请注册，用户名全局唯一，密码为6位数字</li>
                <li><strong>登录</strong>：使用注册的用户名和密码登录，需要网络验证</li>
                <li><strong>记录数据</strong>：每天结束时填写各项资源的总量</li>
                <li><strong>保存数据</strong>：点击"保存到本地"按钮</li>
            </ol>
        </div>
        
        <div class="help-section">
            <h3><i class="fas fa-cloud-upload-alt"></i> 上传到云端</h3>
            <ol class="help-list steps">
                <li>点击右上角<strong>"上传到云端"</strong>按钮</li>
                <li>确认隐私协议</li>
                <li>数据将上传到管理员管理的GitHub仓库</li>
                <li>每天不限上传次数，但会覆盖之前的上传</li>
                <li><strong>重要：</strong>管理员可以看到您的数据，请勿上传敏感信息</li>
            </ol>
            <div class="warning">
                <p><i class="fas fa-exclamation-triangle"></i> <strong>警告：</strong>上传到云端的数据管理员可以看到，请仅上传游戏资源数据。</p>
            </div>
        </div>
        
        <div class="help-section">
            <h3><i class="fas fa-cloud-download-alt"></i> 从云端下载</h3>
            <ol class="help-list steps">
                <li>点击右上角<strong>"从云端下载"</strong>按钮</li>
                <li>确认操作（将覆盖本地所有数据）</li>
                <li>云端数据将替换您本地的所有记录</li>
                <li>原始数据会自动备份，可通过导入备份恢复</li>
            </ol>
            <div class="warning">
                <p><i class="fas fa-exclamation-triangle"></i> <strong>警告：</strong>下载操作会覆盖本地数据，请谨慎操作！</p>
            </div>
        </div>
        
        <div class="help-section">
            <h3><i class="fas fa-database"></i> 本地数据管理</h3>
            <h4>导出数据（备份）</h4>
            <ol class="help-list steps">
                <li>点击右上角<strong>"导出"</strong>按钮</li>
                <li>选择导出当前用户数据或所有用户数据</li>
                <li>浏览器会自动下载备份文件</li>
                <li>建议定期备份重要数据</li>
            </ol>
            
            <h4>导入数据（恢复）</h4>
            <ol class="help-list steps">
                <li>点击右上角<strong>"从文件恢复"</strong>按钮</li>
                <li>选择之前导出的JSON文件</li>
                <li>确认后会覆盖当前数据</li>
                <li>单用户导入时，密码会保留不变</li>
            </ol>
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
            <h3><i class="fas fa-question-circle"></i> 常见问题</h3>
            
            <h4>Q1: 为什么注册/登录需要网络连接？</h4>
            <p>系统强制确保用户名全局唯一，必须连接云端验证用户名是否已被占用。</p>
            
            <h4>Q2: 无网络时能否使用？</h4>
            <p>已注册登录的用户可以查看和修改本地数据，但无法注册新账户、验证登录或同步数据。</p>
            
            <h4>Q3: 上传和下载有什么区别？</h4>
            <p><strong>上传</strong>：将本地数据发送到云端，覆盖云端数据<br>
            <strong>下载</strong>：将云端数据下载到本地，覆盖本地数据<br>
            <strong>注意：</strong>下载会覆盖本地所有记录，请谨慎操作！</p>
            
            <h4>Q4: 能否多设备使用同一账号？</h4>
            <p>可以。在各设备上使用相同用户名登录，然后通过上传/下载保持数据同步。</p>
            
            <h4>Q5: 数据安全如何保障？</h4>
            <p>1. 本地数据仅存储在您的浏览器中<br>
            2. 云端使用腾讯云函数作为中间层，保护GitHub Token<br>
            3. 请勿存储任何敏感个人信息<br>
            4. 建议定期导出备份</p>
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
    alert('隐私政策：\n1. 数据默认存储在浏览器本地\n2. 上传到云端后，数据将通过云函数存储在GitHub Gist中\n3. 管理员可以看到GitHub上的所有用户数据\n4. 请勿存储任何敏感个人信息\n5. 建议定期导出数据备份');
}

function showAbout() {
    alert('关于实况足球资源记录器：\n版本：v2.1（用户名全局唯一）\n功能：记录游戏资源、计算盈亏、数据备份和云端同步\n说明：完全免费，仅供学习交流使用\n作者：实况足球爱好者\n更新日期：2024年\n后端架构：腾讯云函数 + GitHub API');
}

// 测试云函数连接
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
