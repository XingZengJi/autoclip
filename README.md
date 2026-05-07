# 自动剪辑工具

本地网页工具：读取本地图片文件夹，自动裁剪为 9:16，改写处理图 MD5，生成安全轻微运镜，并导出 2160×3840 竖屏 4K MP4。

## 启动

第一次使用先安装依赖：

```bash
pnpm install
```

启动 Next.js 本地服务：

```bash
pnpm dev
```

打开：

```text
http://127.0.0.1:4173
```

## 使用

1. 在网页左侧输入本地图片文件夹路径。
2. 点击“导入”查看图片列表。
3. 点击“生成预览计划”查看裁剪与运镜计划。
4. 点击“开始导出 MP4”。

导出结果默认生成在图片文件夹旁边的 `auto-cut-output` 目录中。

## 测试样例

生成 5 张不同尺寸的测试图片：

```bash
node scripts/create-sample-images.js
```

生成后可在网页中输入：

```text
/Users/xingzengji/Documents/New project 3/sample-images
```

批量测试目录示例：

```text
/Users/xingzengji/Documents/New project 3/batch-sample
```

## 当前默认参数

- 输出分辨率：2160×3840
- 帧率：30fps
- 每张图片：3 秒
- 转场：0.5 秒淡入淡出
- 支持格式：jpg、jpeg、png、webp
