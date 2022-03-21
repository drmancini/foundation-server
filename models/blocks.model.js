/**
 * Initialize User definition
 *
 * @param sequelize DataTypes Instance
 * @returns {BlocksClass} Returns the Users model
 */

/* istanbul ignore next */
module.exports = function( sequelize, DataTypes ) {
  return sequelize.define(
    'blocks', {
      pool: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      block_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      block: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      block_category: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    });
};
