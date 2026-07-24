import db from './pool.db.js'

export function cleanup() {
    try {
        // 强制执行 WAL checkpoint 并截断日志
        // 返回的结果数组每行类似： { busy: 0, log: 0, checkpointed: 0 }
        const result = db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        console.log('Checkpoint result:', result);
        console.log('Done. -wal and -shm files should be gone now.');
    } finally {
        db.close();
    }
}