# 作業 5：Docker

本作業分為兩個獨立的部分，各自有完整的說明與可執行範例。

## 1. docker-basics — Docker 基礎與學習紀錄

Docker 核心觀念與常用指令的學習紀錄，用一個簡單的 Flask 應用走過
`Dockerfile → build → run → Volume → Network → Compose` 的流程。

- 說明文件：[docker-basics/README.md](docker-basics/README.md)
- 範例程式：[docker-basics/docker-lab/](docker-basics/docker-lab/)

## 2. microservices — 多語言微服務系統

以 Docker 建置的多語言微服務系統，包含 Nginx 反向代理、PostgreSQL 資料庫，
以及 Python（主要）、Node.js、Rust 三個應用服務，並提供一個簡易 Web 介面。

![系統架構圖](microservices/images/architecture.svg)

- 說明文件：[microservices/README.md](microservices/README.md)
- 系統定義：[microservices/docker-compose.yml](microservices/docker-compose.yml)

```
Hw5/
├── README.md                 # 本索引
├── docker-basics/            # 部分 1：Docker 基礎學習
│   ├── README.md
│   └── docker-lab/
└── microservices/            # 部分 2：多語言微服務系統
    ├── README.md
    ├── docker-compose.yml
    ├── nginx/
    ├── python-app/
    ├── node-app/
    └── rust-app/
```
