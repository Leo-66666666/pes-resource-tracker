// 配置
const CONFIG = {
    MAX_USERS: 100,
    ADMIN_PASSWORD: '123456'  // 默认管理员密码
};

// 状态管理
let currentUser = null;
let currentDate = new Date().toISOString().split('T')[0];
let userData = {
    records: {}
};

// 初始化本地存储数据
function initializeLocalStorage() {
    // 如果还没有用户列表，创建一个空的
    if (!localStorage.getItem('pes_users')) {
        localStorage.setItem('pes_users', JSON.stringify({
            users: [],
            lastUpdated: new Date().toISOString()
        }));
    }
}

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 初始化本地存储
    initializeLocalStorage();
    
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
        
        // 保存登录信息到本地存储
        localStorage.setItem('pes_current_user', username);
        
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
        const users = JSON.parse(localStorage.getItem('pes_users')).users;
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
        
        // 保存用户数据到localStorage
        localStorage.setItem(`pes_user_${username}`, JSON.stringify(userRecord));
        
        // 更新用户列表
        const usersData = JSON.parse(localStorage.getItem('pes_users'));
        usersData.users.push(username);
        usersData.lastUpdated = new Date().toISOString();
        localStorage.setItem('pes_users', JSON.stringify(usersData));
        
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
    showLogin();
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
    
    // 验证数据
    const yesterdayData = getYesterdayData(date);
    for (const [key, value] of Object.entries(record)) {
        if (key !== 'note' && value < yesterdayData[key]) {
            if (!confirm(`警告：今日${getResourceChineseName(key)}总量(${value})小于昨日(${yesterdayData[key]})。确定要保存吗？`)) {
                return;
            }
        }
    }
    
    // 保存到用户数据
    if (!userData.records) {
        userData.records = {};
    }
    userData.records[date] = record;
    
    // 保存到localStorage
    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
    
    // 更新统计
    updateStats();
    
    // 更新日历显示
    generateCalendar();
    
    alert('今日总量保存成功！系统会自动计算盈亏。');
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
                const detailText = `金币: ${goldSymbol}\n` +
                                 `心仪积分: ${heartChange >= 0 ? '+' : ''}${heartChange}\n` +
                                 `高光券: ${couponsChange >= 0 ? '+' : ''}${couponsChange}\n` +
                                 `新高光: ${newHighlightChange >= 0 ? '+' : ''}${newHighlightChange}\n` +
                                 `返场高光: ${returnHighlightChange >= 0 ? '+' : ''}${returnHighlightChange}\n` +
                                 `退场高光: ${exitHighlightChange >= 0 ? '+' : ''}${exitHighlightChange}\n` +
                                 `高光币: ${coinsChange >= 0 ? '+' : ''}${coinsChange}`;
                
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
                    localStorage.setItem(`pes_user_${currentUser}`, JSON.stringify(userData));
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

// 管理员登录
function openAdmin() {
    const password = prompt('请输入管理员密码：');
    if (password === CONFIG.ADMIN_PASSWORD) {
        window.open('admin.html', '_blank');
    } else {
        alert('密码错误！');
    }
}
