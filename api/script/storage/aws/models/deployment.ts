import * as Sequelize from "sequelize";



export function createDeployment(sequelize: Sequelize.Sequelize) {
    return sequelize.define("deployment", {
        id: { type: Sequelize.STRING, allowNull: true , primaryKey: true},
        name: { type: Sequelize.STRING, allowNull: false },
        key: { type: Sequelize.STRING, allowNull: false },
        package: { type: Sequelize.STRING, allowNull: true, references: {
            model: sequelize.models["package"],
            key: 'id',
          },},
        createdTime: { type: Sequelize.TIME, allowNull: false },
    })
}

