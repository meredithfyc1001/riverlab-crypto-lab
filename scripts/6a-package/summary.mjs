import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = process.env.RIVERLAB_6A_OUTPUT;
await mkdir(output, { recursive: true });

async function evidence(file) {
  try {
    return JSON.parse(await readFile(join(output, file), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

const [install, verification] = await Promise.all([
  evidence('windows-install.json'),
  evidence('verification.json'),
]);
const sha = process.env.EXPECTED_SHA;
for (const commit of [install?.sourceSha, verification?.commit]) {
  if (commit && commit !== sha)
    throw new Error('Windows evidence commit differs from the PR head.');
}
const steps = JSON.parse(process.env.STAGE_OUTCOMES);
const lines = [
  '# Phase 6A Windows x64 验收记录',
  '',
  `PR 提交 \`${sha}\`。`,
  '',
  `[Actions 执行日志](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})`,
  '',
  '| 步骤 | 状态 |',
  '| --- | --- |',
  ...Object.entries(steps).map(([name, status]) => `| ${name} | ${status} |`),
];
if (install) {
  lines.push(
    '',
    `Windows 内核 ${install.system}，镜像 ${install.runnerImage}。每用户安装目录共 ${install.installedDirectoryBytes} 字节。`,
    `内层 ZIP 共 ${install.archiveBytes} 字节，SHA-256 为 \`${install.archiveSha256}\`。`,
  );
}
if (verification) {
  lines.push('', `桌面与系统 Edge 的验证结果为 **${verification.status}**。`);
  if (verification.application && verification.installer) {
    lines.push(
      '',
      `独立 EXE 共 ${verification.application.bytes} 字节，NSIS 安装器共 ${verification.installer.bytes} 字节，前端资源共 ${verification.frontendPayloadBytes} 字节。包依赖已安装的 WebView2 Runtime。`,
    );
  }
  if (verification.runs.length) {
    lines.push(
      '',
      '| 引擎 | 版本 | 次序 | 工作台就绪 ms | 首个 CSV Worker 响应 ms | 空闲私有提交 MiB¹ | 负载峰值私有提交 MiB² | 负载峰值工作集 MiB² |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    const mib = (bytes) =>
      Number.isFinite(bytes) ? (bytes / 1048576).toFixed(1) : '—';
    for (const run of verification.runs) {
      const idle = run.memorySamples
        ?.filter((sample) => sample.phase === 'idle')
        .at(-1);
      lines.push(
        `| ${run.kind} | ${run.engineVersion ?? '—'} | ${run.iteration} | ${run.workbenchMs ?? '—'} | ${run.firstCsvWorkerMs ?? '—'} | ${mib(idle?.privateBytes)} | ${mib(run.sampledPeakPrivateBytes)} | ${mib(run.sampledPeakWorkingSetBytes)} |`,
      );
    }
    lines.push(
      '',
      '每次启动使用独立空配置，操作系统文件缓存未控制，计时包含连接自动化驱动。¹ 空闲期最后一次进程树采样。² 首轮运行完整工作负载，峰值取进程树采样最大值，共享页面可计入多个进程工作集。',
    );
  }
  if (verification.parity) {
    const { bars, evaluations, sha256, completedTrades } = verification.parity;
    lines.push(
      '',
      `双引擎核对涵盖 ${bars} 根、${evaluations} 次求值、${completedTrades} 笔已平仓交易，结果 SHA-256 为 \`${sha256}\`。`,
    );
  }
}
lines.push(
  '',
  '本记录来自 GitHub Windows 托管机。用户 Windows 11 物理机及物理断网测试单独记录。',
  '',
);
const markdown = lines.join('\n');
await writeFile(join(output, 'windows-results.md'), markdown);
await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
