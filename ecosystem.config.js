module.exports = {
    apps: [
        {
            name: 'code-push-server',
            cwd: './api',
            script: 'npm',
            args: 'run start:env',
            env: {
                NODE_ENV: 'development',
            },
            env_production: {
                NODE_ENV: 'prod',
            }
        }
    ]
};
