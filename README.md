流年‘s 主页
一个由C++ Web服务器支持的个人主页：使用Drogon处理HTTP，SQLite用于存储，CMake进行构建。前端是一个HTML页面，从数据库中获取项目列表；
```
liunian-homepage/
├── CMakeLists.txt          构建配置
├── config.json             Drogon 服务器配置（端口、数据库、静态根目录）
├── main.cc                         入口点，首次运行时创建 SQLite SQLite 表
├── controllers/
│     └── ApiController.*     GET /api/projects, POST /api/contact
├── db/
│     └── schema.sql             参考架构（用于手动设置，可选）
└── wwwroot/                 实际网站
    ├── index.html
    ├── css/style.css
      └── js/site.js```