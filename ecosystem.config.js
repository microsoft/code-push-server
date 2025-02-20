module.exports = {
    apps: [
        {
            name: "code_push_server",
            script: "npm",
            args: "run start:env",
            cwd: "./api/"
        }
    ]
};