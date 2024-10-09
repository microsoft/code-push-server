import * as Sequelize from "sequelize";

export function createAccount(sequelize: Sequelize.Sequelize) {
    return sequelize.define("account", {
        azureAdId: { type: Sequelize.STRING, allowNull: true },
        createdTime: { type: Sequelize.FLOAT, allowNull: false },
        name: { type: Sequelize.STRING, allowNull: false },
        email: { type: Sequelize.STRING, allowNull: false },
        id: { type: Sequelize.STRING, allowNull: false, primaryKey:true},
        microsoftId: { type: Sequelize.STRING, allowNull: true},
        gitHubId: { type: Sequelize.STRING, allowNull: true},
    })
}

