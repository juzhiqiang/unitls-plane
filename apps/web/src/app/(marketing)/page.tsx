import Link from "next/link";
import { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Image, FileType, Type, Shield, Zap, Globe } from "lucide-react";

export const metadata: Metadata = {
  title: "Utils Plane - 免费在线工具平台",
  description: "图片压缩、PDF处理、字体转换，一站式工具平台。客户端处理保护隐私，高性能免费使用。",
  openGraph: {
    title: "Utils Plane - 免费在线工具平台",
    description: "图片压缩、PDF处理、字体转换，一站式工具平台",
    type: "website",
  },
};

const features = [
  {
    icon: Image,
    title: "图片工具",
    description: "支持 PNG、JPG、WebP、GIF 格式，无损压缩、智能转换",
  },
  {
    icon: FileType,
    title: "PDF 工具",
    description: "合并、拆分、提取页面，在线处理无需安装软件",
  },
  {
    icon: Type,
    title: "字体转换",
    description: "TTF、OTF、WOFF 之间转换，批量处理更高效",
  },
];

const highlights = [
  {
    icon: Zap,
    title: "高性能",
    description: "客户端处理，原地上传无需等待",
  },
  {
    icon: Shield,
    title: "隐私保护",
    description: "文件仅在浏览器中处理，不上传服务器",
  },
  {
    icon: Globe,
    title: "免费使用",
    description: "无需注册，所有功能完全免费",
  },
];

export default function MarketingPage() {
  return (
    <div className="relative">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                            linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center">
        <div className="container-main">
          <div className="max-w-2xl">
            <div className="text-sm text-muted-foreground mb-4 font-mono">
              <span className="text-accent">01</span> / 04
            </div>
            <h1 className="text-5xl md:text-7xl font-medium tracking-tight text-foreground leading-tight">
              你的桌面
              <br />
              工具箱
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-lg">
              图片压缩、PDF处理、字体转换。所有操作在浏览器本地完成，保护你的隐私。
            </p>
            <div className="mt-8 flex gap-4">
              <Link href="/image">
                <Button size="lg" className="h-11 px-6">
                  开始使用
                </Button>
              </Link>
              <Link href="/docs">
                <Button variant="outline" size="lg" className="h-11 px-6">
                  查看文档
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 border-t border-border">
        <div className="container-main">
          <div className="text-sm text-muted-foreground mb-4 font-mono">
            <span className="text-accent">02</span> / 04 — 功能
          </div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            一切皆可处理
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map((feature, index) => (
              <Link key={feature.title} href={`/${feature.title === "图片工具" ? "image" : feature.title === "PDF 工具" ? "pdf" : "font"}`}>
                <Card className="h-full transition-colors hover:border-accent/50">
                  <CardContent className="p-6">
                    <feature.icon
                      className="h-8 w-8 text-accent mb-4"
                      strokeWidth={1.5}
                    />
                    <h3 className="text-lg font-medium">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Highlights Section */}
      <section className="py-24 border-t border-border">
        <div className="container-main">
          <div className="text-sm text-muted-foreground mb-4 font-mono">
            <span className="text-accent">03</span> / 04 — 特点
          </div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            为何选择我们
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="p-6 border border-border rounded-lg"
              >
                <item.icon
                  className="h-6 w-6 text-accent mb-4"
                  strokeWidth={1.5}
                />
                <h3 className="text-lg font-medium">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 border-t border-border">
        <div className="container-main text-center">
          <div className="text-sm text-muted-foreground mb-4 font-mono">
            <span className="text-accent">04</span> / 04
          </div>
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
            立即开始使用
          </h2>
          <p className="mt-4 text-muted-foreground max-w-md mx-auto">
            无需注册，直接使用。所有功能免费，隐私保护无忧。
          </p>
          <div className="mt-8">
            <Link href="/image">
              <Button size="lg" className="h-11 px-8">
                立即体验
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}