import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: "/tech-notes/",
  title: "Tech Notes",
  description: "Comprehensive tech notes: mobile development, cross-platform, AI tools, CI/CD, and modern engineering practices.",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '主页', link: '/' },
      { text: '笔记', link: '/ios/Swift 内存' }
    ],

    sidebar: [
      {
        text: 'iOS',
        items: [
          { text: 'Swift 内存', link: '/ios/Swift 内存' },
          // { text: 'Runtime API Examples', link: '/api-examples' }
        ]
      },
      {
        text: 'Android',
        items: [
          // { text: 'Swift 内存', link: '/ios/Swift 内存' },
          // { text: 'Runtime API Examples', link: '/api-examples' }
        ]
      },
      {
        text: 'React Native',
        items: [
          // { text: 'Swift 内存', link: '/ios/Swift 内存' },
          // { text: 'Runtime API Examples', link: '/api-examples' }
        ]
      },
      {
        text: 'Flutter',
        items: [
          // { text: 'Swift 内存', link: '/ios/Swift 内存' },
          // { text: 'Runtime API Examples', link: '/api-examples' }
        ]
      },
      {
        text: 'AI',
        items: [
          { text: 'Claude Code Skill 优化', link: '/AI/Claude Code Skill 优化' },
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ]
  }
})
