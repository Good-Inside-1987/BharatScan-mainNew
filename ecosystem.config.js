// PM2 process configuration for Oracle production deployment.
// Three separate named processes so deploys only restart the web
// server without touching the scheduler or Cloudflare tunnel.
module.exports = {
  apps: [
    {
      name: 'bharatscan',
      script: 'server/dist/index.js',
      node_args: '--experimental-vm-modules',
      env_production: {
        NODE_ENV: 'production',
        SERVER_PORT: '3001',
      },
      error_file: 'logs/bharatscan-error.log',
      out_file: 'logs/bharatscan-out.log',
      time: true,
    },
    {
      name: 'bharatscan-scheduler',
      script: 'server/dist/scheduler/standalone.js',
      node_args: '--experimental-vm-modules',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/scheduler-error.log',
      out_file: 'logs/scheduler-out.log',
      time: true,
    },
    {
      name: 'bharatscan-tunnel',
      script: 'cloudflared',
      args: 'tunnel run',
      interpreter: 'none',
      autorestart: true,
      error_file: 'logs/tunnel-error.log',
      out_file: 'logs/tunnel-out.log',
    },
  ],
};
