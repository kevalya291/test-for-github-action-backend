module.exports = {
  apps: [
    {
      name: "quickkart-api",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 5000,
        // Set a real secret in the shell before `pm2 start`, e.g.
        // JWT_SECRET=$(openssl rand -hex 32) pm2 start ecosystem.config.cjs
        JWT_SECRET: process.env.JWT_SECRET,
      },
    },
  ],
};
