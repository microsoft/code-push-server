import * as Sequelize from "sequelize";

export function createAccessKey(sequelize: Sequelize.Sequelize) {
    return sequelize.define("accessKey", {
        createdBy: { type: Sequelize.STRING, allowNull: false },
        createdTime: { type: Sequelize.FLOAT, allowNull: false },
        expires: { type: Sequelize.FLOAT, allowNull: false },
        description: { type: Sequelize.STRING, allowNull: true },
        friendlyName: { type: Sequelize.STRING, allowNull: false},
        name: { type: Sequelize.STRING, allowNull: false},
        id: { type: Sequelize.STRING, allowNull: false, primaryKey: true},
        isSession: { type: Sequelize.BOOLEAN, allowNull: true},
        accountId: { type: Sequelize.STRING, allowNull: false, references: {
            model: sequelize.models["account"],
            key: 'id',
          },},
    })
}

