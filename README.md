# AVIF Convertor (VSCode Extension)

在 VSCode 的资源管理器里右键 **文件** 或 **目录**，一键把 `png/jpg/jpeg/gif/apng` 转成 `avif`（底层调用 `avifenc`）。

## 功能

- 右键 **文件**：直接生成同名 `.avif`
- 右键 **目录**：批量扫描并转换（可递归）
- 输出路径：
  - 默认：输出到原文件同目录
  - 设置 `avifConvert.outDir`：输出到指定目录（对目录转换会尽量保留相对路径）
- macOS 自动安装（可选）：检测不到 `avifenc` 时可提示执行 `brew install libavif`

## 安装/开发

1. 安装依赖

```bash
npm install
```

2. 编译

```bash
npm run compile
```

3. 在 VSCode 里按 `F5` 启动 **Extension Development Host**，在新窗口的资源管理器里右键图片/目录测试。

## 配置项

在 VSCode Settings 里搜索 `AVIF Convertor` 或 `avifConvert`：

- `avifConvert.crf`：0-63，越小质量越高（默认 20）
- `avifConvert.speed`：0-10，越大越快但质量更差（默认 6）
- `avifConvert.lossless`：是否无损（默认 false）
- `avifConvert.recursive`：目录转换是否递归（默认 true）
- `avifConvert.outDir`：输出目录（默认空=同目录）
- `avifConvert.overwrite`：是否覆盖已有 `.avif`（默认 false）
- `avifConvert.jobs`：传给 `avifenc` 的 `-j/--jobs`（默认 0=不传）
- `avifConvert.autoInstallOnMac`：macOS 缺少 `avifenc` 时是否提示 Homebrew 安装（默认 true）

## 依赖

需要本机可执行 `avifenc`（libavif）。macOS 推荐：

```bash
brew install libavif
```

