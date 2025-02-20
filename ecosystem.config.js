module.exports = {
    apps: [
        {
            name: "code_push_server",
            script: "npm",
            args: "run start:env",
            cwd: "./api/",
            out_file: "./logs/out.log",
            error_file: "./logs/error.log",
        }
    ]
};