// 配置
const CONFIG = {
    REPO_OWNER: 'Leo-66666666', // 替换为你的GitHub用户名
    REPO_NAME: 'pes-resource-data',     // 数据仓库名称
    BRANCH: 'main',
    MAX_USERS: 100
};

// 状态管理
let currentUser = null;
let currentDate = new Date().toISOString().split('T')[0];
let userData = {
    records: {}
};

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 设置今天日期
    document.getElementById('current-date').value = currentDate;
    
    // 显示登录界面
    showLogin();
    
    // 如果之前有登录信息，尝试自动登录
    const savedUser = localStorage.getItem('pes_current_user');
    const savedPass = localStorage.getItem('pes_current_pass');
    if (savedUser && savedPass) {
        document.getElementById('username').value = savedUser;
        document.getElementById('password').value = savedPass;
    }
    
    // 初始化日历
    generateCalendar();
});

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
        // 加载用户数据
        await loadUserData(username, password);
        currentUser = username;
        
        // 保存登录信息到本地存储
        localStorage.setItem('pes_current_user', username);
        localStorage.setItem('pes_current_pass', password);
        
        // 显示用户信息
        document.getElementById('current-user').textContent = `用户: ${username}`;
        
        // 显示主界面
        showMain();
        
        // 加载今天的数据
        loadDateData();
        
        // 更新统计
        updateStats();
        
    } catch (error) {
        alert('登录失败：' + error.message);
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
    
    if (password !== confirm) {
        alert('两次输入的密码不一致！');
        return;
    }
    
    if (!/^\d{6}$/.test(password)) {
        alert('密码必须是6位数字！');
        return;
    }
    
    try {
        // 检查用户是否已存在
        const users = await getAllUsers();
        if (users.includes(username)) {
            throw new Error('用户名已存在！');
        }
        
        if (users.length >= CONFIG.MAX_USERS) {
            throw new Error('用户数量已达上限！');
        }
        
        // 创建新用户数据
        const userRecord = {
            username: username,
            password: password,
            createdAt: new Date().toISOString(),
            records: {}
        };
        
        // 保存用户数据
        await saveUserData(username, userRecord);
        
        alert('注册成功！请登录。');
        showLogin();
        document.getElementById('username').value = username;
        document.getElementById('password').value = password;
        
    } catch (error) {
        alert('注册失败：' + error.message);
    }
}

// 退出登录
function logout() {
    currentUser = null;
    userData = { records: {} };
    localStorage.removeItem('pes_current_user');
    localStorage.removeItem('pes_current_pass');
    showLogin();
}

// 加载用户数据
async function loadUserData(username, password) {
    try {
        // 从GitHub加载用户数据
        const data = await fetchGitHubData(username);
        
        // 验证密码
        if (data.password !== password) {
            throw new Error('密码错误！');
        }
        
        userData = data;
        return data;
    } catch (error) {
        // 如果用户不存在，创建新用户数据
        if (error.message.includes('404')) {
            throw new Error('用户不存在！');
        }
        throw error;
    }
}

// 从GitHub获取数据
async function fetchGitHubData(username) {
    const url = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${CONFIG.BRANCH}/data/${username}.json`;
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error('用户数据不存在');
    }
    
    return await response.json();
}

// 获取所有用户
async function getAllUsers() {
    try {
        // 尝试获取用户列表
        const url = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${CONFIG.BRANCH}/users.json`;
        const response = await fetch(url);
        
        if (response.ok) {
            const data = await response.json();
            return data.users || [];
        }
    } catch (error) {
        // 如果文件不存在，返回空数组
        return [];
    }
    return [];
}

// 保存用户数据到GitHub
async function saveUserData(username, data) {
    // 注意：由于GitHub Pages是静态的，我们无法直接写入
    // 这里我们使用GitHub的Gists作为临时解决方案
    // 在实际使用中，你需要创建一个GitHub仓库来存储数据
    // 或者使用其他免费的数据库服务
    
    // 这里我们使用localStorage作为替代方案
    localStorage.setItem(`pes_user_${username}`, JSON.stringify(data));
    
    // 更新用户列表
    const users = await getAllUsers();
    if (!users.includes(username)) {
        users.push(username);
        localStorage.setItem('pes_users', JSON.stringify({ users: users }));
    }
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
    const record = {
        gold: parseInt(document.getElementById('gold').value) || 0,
        heart_points: parseInt(document.getElementById('heart-points').value) || 0,
        highlight_coupons: parseInt(document.getElementById('highlight-coupons').value) || 0,
        new_highlight: parseInt(document.getElementById('new-highlight').value) || 0,
        return_highlight: parseInt(document.getElementById('return-highlight').value) || 0,
        exit_highlight: parseInt(document.getElementById('exit-highlight').value) || 0,
        highlight_coins: parseInt(document.getElementById('highlight-coins').value) || 0
    };
    
    // 保存到用户数据
    if (!userData.records) {
        userData.records = {};
    }
    userData.records[date] = record;
    
    // 保存到GitHub（这里使用localStorage替代）
    await saveUserData(currentUser, userData);
    
    // 更新统计
    updateStats();
    
    // 更新日历显示
    generateCalendar();
    
    alert('数据保存成功！');
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
        alert('昨日数据已导入！');
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
    
    // 添加日期单元格
    let totalGold = 0;
    let totalHeart = 0;
    let hasDataDays = 0;
    
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
            
            // 计算盈亏
            const goldChange = record.gold || 0;
            const heartChange = record.heart_points || 0;
            
            totalGold += goldChange;
            totalHeart += heartChange;
            hasDataDays++;
            
            // 添加数据提示
            const dataEl = document.createElement('div');
            dataEl.className = 'day-data';
            dataEl.innerHTML = `💰${goldChange > 0 ? '+' : ''}${goldChange}`;
            dayEl.appendChild(dataEl);
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
        <h3>${monthNames[month]} ${year} 统计</h3>
        <p>本月有 ${hasDataDays} 天记录数据</p>
        <p>金币累计：${totalGold >= 0 ? '+' : ''}${totalGold}</p>
        <p>心仪积分累计：${totalHeart >= 0 ? '+' : ''}${totalHeart}</p>
    `;
}

// 更新统计数据
function updateStats() {
    if (!userData.records) {
        userData.records = {};
    }
    
    let totalGold = 0;
    let totalHeart = 0;
    let totalCoupons = 0;
    let totalCoins = 0;
    
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // 只统计本月的
    for (const [date, record] of Object.entries(userData.records)) {
        const recordDate = new Date(date);
        if (recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear) {
            totalGold += record.gold || 0;
            totalHeart += record.heart_points || 0;
            totalCoupons += record.highlight_coupons || 0;
            totalCoins += record.highlight_coins || 0;
        }
    }
    
    document.getElementById('total-gold').textContent = totalGold;
    document.getElementById('total-heart').textContent = totalHeart;
    document.getElementById('total-coupons').textContent = totalCoupons;
    document.getElementById('total-coins').textContent = totalCoins;
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
}

// 导入数据（从备份恢复）
function importData() {
    if (!currentUser) {
        alert('请先登录！');
        return;
    }
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(event) {
        const file = event.target.files[0];
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (importedData.username === currentUser) {
                    userData = importedData;
                    saveUserData(currentUser, userData);
                    alert('数据导入成功！');
                    loadDateData();
                    updateStats();
                    generateCalendar();
                } else {
                    alert('数据用户不匹配！');
                }
            } catch (error) {
                alert('导入失败：文件格式错误！');
            }
        };
        
        reader.readAsText(file);
    };
    
    input.click();
}