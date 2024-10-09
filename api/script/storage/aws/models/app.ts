import * as Sequelize from "sequelize";



export function createApp(sequelize: Sequelize.Sequelize) {
    return sequelize.define("apps", {
        createdTime: { type: Sequelize.FLOAT, allowNull: false },
        name: { type: Sequelize.STRING, allowNull: false },
        id: { type: Sequelize.STRING, allowNull: false, primaryKey:true},
        accountId: { type: Sequelize.STRING, allowNull: false, references: {
            model: sequelize.models["account"],
            key: 'id',
          },
        }
    })
}

