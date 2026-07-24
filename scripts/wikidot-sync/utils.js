import readline from 'readline';

// 暂停状态与等待恢复的队列
let paused = false;
const resumeListeners = [];

// 初始化按键监听（回车切换暂停/继续）
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('keypress', (str, key) => {
    // 回车键：切换暂停状态
    if (key.name === 'return') {
        paused = !paused;
        if (!paused) {
            // 通知所有等待中的任务
            for (const resolve of resumeListeners) {
                resolve();
            }
            resumeListeners.length = 0;
        }
        console.log(paused ? '\n⏸️  已暂停，按回车继续' : '▶️  已继续');
    }

    // 可以添加其他按键，例如按 q 退出（如果需要）
    if (key.name === 'q' && key.ctrl) {
        console.log('\n👋 退出程序');
        process.exit();
    }
});

// 暂停时挂起的 Promise
export function waitIfPaused() {
    if (!paused) return Promise.resolve();
    return new Promise(resolve => {
        resumeListeners.push(resolve);
    });
}