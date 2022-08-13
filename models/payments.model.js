/**
 * Initialize User definition
 *
 * @param sequelize DataTypes Instance
 * @returns {PaymentsClass} Returns the Users model
 */

/* istanbul ignore next */
module.exports = function( sequelize, DataTypes ) {
  return sequelize.define(
    'payments', {
      pool: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      block_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      time: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      paid: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      transaction: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      miner: {
        type: DataTypes.STRING,
        allowNull: false,
      }
    });
};
