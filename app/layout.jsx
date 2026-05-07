import "./globals.css";

export const metadata = {
  title: "批量自动剪辑工具",
  description: "本地图片批量剪辑为竖屏 4K 视频"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
