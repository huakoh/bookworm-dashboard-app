#!/usr/bin/env node
/**
 * Bookworm Dashboard 数据生成器
 * 从 .claude/ 目录采集实时数据，输出 docs/data.json
 *
 * 用法: node scripts/generate-data.js
 */

const fs = require('fs');
const path = require('path');

// 路径配置 (支持环境变量覆盖)
// 优先: 环境变量 > WSL Windows 路径 > 默认 HOME
const CLAUDE_HOME = process.env.CLAUDE_HOME || (() => {
  const candidates = [
    '/mnt/c/Users/home/.claude',
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude')
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'settings.json'))) return p;
  }
  return candidates[0];
})();
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data.json');

// 安全读取文件
function readSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

// 解析 JSONL 文件
function parseJsonl(filePath) {
  const content = readSafe(filePath);
  if (!content) return [];
  return content.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// 获取目录大小 (MB)
function getDirSizeMB(dirPath) {
  let totalSize = 0;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true, recursive: true });
    for (const item of items) {
      if (item.isFile()) {
        try {
          const fullPath = path.join(item.parentPath || item.path || dirPath, item.name);
          totalSize += fs.statSync(fullPath).size;
        } catch { /* 忽略 */ }
      }
    }
  } catch { /* 目录不存在 */ }
  return +(totalSize / 1024 / 1024).toFixed(1);
}

// 收集健康检查数据
function collectHealth() {
  // 尝试运行 health-check 脚本
  const healthScript = path.join(CLAUDE_HOME, 'scripts', 'health-check.js');
  if (fs.existsSync(healthScript)) {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`node "${healthScript}" --json 2>/dev/null`, {
        timeout: 10000, encoding: 'utf-8'
      });
      const result = JSON.parse(output);
      if (result.dimensions) return result;
    } catch { /* 降级到默认 */ }
  }

  // 默认数据
  return {
    score: 0,
    dimensions: [
      { name: '配置一致性', score: 0, status: 'INFO' },
      { name: '行为基线', score: 0, status: 'INFO' },
      { name: '磁盘健康', score: 0, status: 'INFO' },
      { name: '钩子完整性', score: 0, status: 'INFO' },
      { name: '技能索引', score: 0, status: 'INFO' },
      { name: '规则缓存', score: 0, status: 'INFO' },
      { name: '路由准确率', score: 0, status: 'INFO' },
      { name: '学习收敛', score: 0, status: 'INFO' },
      { name: '路由合规率', score: 0, status: 'INFO' }
    ]
  };
}

// 收集活动日志事件统计
function collectEvents(days = 7) {
  const debugDir = path.join(CLAUDE_HOME, 'debug');
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const result = { total: 0, skills: 0, agents: 0, mcp: 0, bash: 0, write: 0 };

  try {
    const files = fs.readdirSync(debugDir).filter(f => f.startsWith('activity-') && f.endsWith('.jsonl'));
    for (const file of files) {
      const entries = parseJsonl(path.join(debugDir, file));
      for (const entry of entries) {
        const ts = new Date(entry.timestamp || entry.ts || 0).getTime();
        if (ts < cutoff) continue;
        result.total++;
        const type = entry.type || entry.tool || '';
        if (type.includes('Skill')) result.skills++;
        else if (type.includes('Task') || type.includes('agent')) result.agents++;
        else if (type.includes('mcp')) result.mcp++;
        else if (type === 'Bash') result.bash++;
        else if (type === 'Write' || type === 'Edit') result.write++;
      }
    }
  } catch { /* 目录不存在 */ }
  return result;
}

// 收集 Top Skills
function collectTopSkills() {
  const feedbackFile = path.join(CLAUDE_HOME, 'debug', 'route-feedback.jsonl');
  const entries = parseJsonl(feedbackFile);
  const counts = {};
  for (const entry of entries) {
    const skill = entry.routed || entry.skill || entry.recommended;
    if (skill) counts[skill] = (counts[skill] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

// 收集安全事件
function collectSecurity() {
  const debugDir = path.join(CLAUDE_HOME, 'debug');
  const result = { total: 0, deny: 0, ask: 0, hooks: {} };

  try {
    const files = fs.readdirSync(debugDir).filter(f => f.startsWith('security-') && f.endsWith('.jsonl'));
    for (const file of files) {
      const entries = parseJsonl(path.join(debugDir, file));
      for (const entry of entries) {
        result.total++;
        const action = entry.action || entry.decision || '';
        if (action === 'deny' || action === 'blocked') result.deny++;
        else if (action === 'ask' || action === 'prompted') result.ask++;

        const hook = entry.hook || entry.source || 'unknown';
        if (!result.hooks[hook]) result.hooks[hook] = { deny: 0, ask: 0 };
        if (action === 'deny' || action === 'blocked') result.hooks[hook].deny++;
        else if (action === 'ask' || action === 'prompted') result.hooks[hook].ask++;
      }
    }
  } catch { /* 目录不存在 */ }

  const hooksArr = Object.entries(result.hooks)
    .map(([name, counts]) => [name, `${counts.deny} deny / ${counts.ask} ask`])
    .sort((a, b) => {
      const totalA = result.hooks[a[0]].deny + result.hooks[a[0]].ask;
      const totalB = result.hooks[b[0]].deny + result.hooks[b[0]].ask;
      return totalB - totalA;
    });

  return { total: result.total, deny: result.deny, ask: result.ask, hooks: hooksArr };
}

// 收集磁盘数据
function collectDisk() {
  const totalMB = getDirSizeMB(CLAUDE_HOME);
  const debugMB = getDirSizeMB(path.join(CLAUDE_HOME, 'debug'));
  const debugPercent = totalMB > 0 ? +((debugMB / totalMB) * 100).toFixed(1) : 0;
  const barPercent = +((totalMB / 4096) * 100).toFixed(1); // 4GB 为参考
  const status = totalMB >= 16384 ? 'CRITICAL' : totalMB >= 8192 ? 'WARNING' : 'GOOD';

  // 统计日志文件数
  let activityLogs = 0, securityLogs = 0;
  try {
    const files = fs.readdirSync(path.join(CLAUDE_HOME, 'debug'));
    activityLogs = files.filter(f => f.startsWith('activity-')).length;
    securityLogs = files.filter(f => f.startsWith('security-')).length;
  } catch { /* 忽略 */ }

  return { totalMB, debugMB, debugPercent, barPercent, activityLogs, securityLogs, status };
}

// 收集演化日志
function collectEvolution() {
  // 搜索 evolution-log.jsonl (可能在 projects 子目录下)
  let evoFile = path.join(CLAUDE_HOME, 'debug', 'evolution-log.jsonl');
  if (!fs.existsSync(evoFile)) {
    const projectsDir = path.join(CLAUDE_HOME, 'projects');
    try {
      const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const candidate = path.join(projectsDir, d.name, 'memory', 'evolution-log.jsonl');
        if (fs.existsSync(candidate)) { evoFile = candidate; break; }
      }
    } catch { /* 忽略 */ }
  }
  const entries = parseJsonl(evoFile);
  const versions = {};
  let latestVersion = 'unknown';

  for (const entry of entries) {
    const ver = entry.version || 'unknown';
    versions[ver] = (versions[ver] || 0) + 1;
    latestVersion = ver;
  }

  const latestFixes = versions[latestVersion] || 0;
  return { entries: entries.length, latestVersion, latestFixes, versions };
}

// 收集 MCP 使用
function collectMcpUsage() {
  const debugDir = path.join(CLAUDE_HOME, 'debug');
  const counts = {};

  try {
    const files = fs.readdirSync(debugDir).filter(f => f.startsWith('activity-') && f.endsWith('.jsonl'));
    for (const file of files) {
      const entries = parseJsonl(path.join(debugDir, file));
      for (const entry of entries) {
        if ((entry.type || '').includes('mcp') || (entry.tool || '').startsWith('mcp__')) {
          const name = entry.tool || entry.name || 'unknown';
          counts[name] = (counts[name] || 0) + 1;
        }
      }
    }
  } catch { /* 忽略 */ }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

// 读取系统信息 (从 CLAUDE.md)
function collectSystemInfo() {
  const claudeMd = readSafe(path.join(CLAUDE_HOME, 'CLAUDE.md')) || '';
  const extract = (pattern) => {
    const m = claudeMd.match(pattern);
    return m ? m[1].trim() : '--';
  };

  return {
    skills: extract(/总技能数.*?:\s*(\d+[^*\n]*)/),
    agents: extract(/智能体数.*?:\s*(\d+[^*\n]*)/),
    hooks: extract(/钩子数.*?:\s*(\d+[^*\n]*)/),
    mcp: extract(/MCP 数.*?:\s*(\d+[^*\n]*)/),
    tests: extract(/(\d+\+?\s*tests\s*\/\s*\d+\s*files)/),
    routeAccuracy: '82%', // 从 route-feedback 动态计算时可替换
    feedbacks: '--'
  };
}

// 主函数
function main() {
  console.log('采集 Bookworm 系统数据...');
  console.log('CLAUDE_HOME:', CLAUDE_HOME);

  const today = new Date().toISOString().split('T')[0];

  // 读取路由准确率
  const feedbackFile = path.join(CLAUDE_HOME, 'debug', 'route-feedback.jsonl');
  const feedbackEntries = parseJsonl(feedbackFile);
  const totalFeedback = feedbackEntries.length;
  const corrections = feedbackEntries.filter(e => e.corrected || e.type === 'correction').length;
  const accuracy = totalFeedback > 0 ? Math.round((1 - corrections / totalFeedback) * 100) + '%' : '--';

  const sysInfo = collectSystemInfo();
  sysInfo.routeAccuracy = accuracy;
  sysInfo.feedbacks = `${totalFeedback} / ${corrections} corrections`;

  const data = {
    timestamp: today,
    range: '7d',
    version: 'v5.3',
    health: collectHealth(),
    events: collectEvents(7),
    topSkills: collectTopSkills(),
    security: collectSecurity(),
    disk: collectDisk(),
    evolution: collectEvolution(),
    mcpUsage: collectMcpUsage(),
    system: sysInfo
  };

  // 统一健康评分字段名 (health-check 返回 overallScore)
  if (data.health.overallScore !== undefined) {
    data.health.score = data.health.overallScore;
    delete data.health.overallScore;
    delete data.health.overallStatus;
    delete data.health.ts;
  }
  // 降级: 手动计算平均分
  if (!data.health.score && data.health.dimensions.some(d => d.score > 0)) {
    data.health.score = Math.round(
      data.health.dimensions.reduce((s, d) => s + d.score, 0) / data.health.dimensions.length
    );
  }

  // 质量评分
  try {
    const qualityAnalyzer = require(path.join(CLAUDE_HOME, 'scripts', 'quality-analyzer.js'));
    const qr = qualityAnalyzer.analyze({ days: 30 });
    data.quality = {
      avgScore: qr.summary.avgQualityScore,
      activeSkills: qr.summary.activeSkills,
      lowQualityCount: qr.summary.lowQualityCount,
      topSkills: qr.topSkills.slice(0, 5),
      bottomSkills: qr.bottomSkills.slice(0, 5),
      recommendations: qr.recommendations.slice(0, 5),
      mcp: Object.entries(qr.mcp).map(([name, d]) => ({
        name, calls: d.calls, success: d.scores.success
      })).sort((a, b) => b.calls - a.calls).slice(0, 5),
    };
  } catch {
    data.quality = null;
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log('数据已写入:', OUTPUT_PATH);
  console.log('健康评分:', data.health.score);
  console.log('事件总数:', data.events.total);
  console.log('磁盘使用:', data.disk.totalMB, 'MB');
}

main();
